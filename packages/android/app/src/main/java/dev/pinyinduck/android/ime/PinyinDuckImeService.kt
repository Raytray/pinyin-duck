package dev.pinyinduck.android.ime

import android.inputmethodservice.InputMethodService
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.data.OpenedDictionary
import dev.pinyinduck.android.ui.KeyAction
import dev.pinyinduck.android.ui.KeyLayout
import dev.pinyinduck.android.ui.KeyboardCallbacks
import dev.pinyinduck.android.ui.PinyinDuckKeyboard
import dev.pinyinduck.android.ui.PinyinDuckTheme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The PinyinDuck input method.
 *
 * Owns the three things an IME needs: the window the platform asks for, the editor it is
 * typing into, and the composition rules that decide what a keystroke means.
 *
 * The dictionary is mapped off the APK on a background thread and the composition rules
 * live in [PinyinDuckSession], which knows nothing about Android. What is left here is
 * wiring, and that is deliberate: the parts that are hard to get right are testable without
 * a device.
 */
class PinyinDuckImeService :
    InputMethodService(),
    LifecycleOwner,
    SavedStateRegistryOwner {
    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateRegistryController = SavedStateRegistryController.create(this)

    private val settings by lazy { KeyboardSettings(this) }

    /**
     * The scope the dictionary load runs in.
     *
     * Cancelled in [onDestroy], so a load that is still in flight when the user switches
     * away from the keyboard cannot come back and reassign [dictionary] and [session] on a
     * service that is already gone. A raw `Thread` has no handle to cancel, which is why
     * this is a scope and not the thread it replaced.
     */
    private val dictionaryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private var dictionary: OpenedDictionary? = null

    // `internal` rather than `private` so `PinyinDuckImeServiceTest` can assert on the state
    // the wiring produces. This is the app's only entry point, and it is where a broken
    // reference to the session or a mis-wired callback would show up; leaving it untested
    // would mean the only untested class is the one the user actually runs.
    internal var session: PinyinDuckSession? = null

    internal var uiState by mutableStateOf(KeyboardUiState())

    override val lifecycle: Lifecycle get() = lifecycleRegistry

    override val savedStateRegistry: SavedStateRegistry get() = savedStateRegistryController.savedStateRegistry

    /** Reaches the field the user is typing into. */
    private val editor = EditorSink()

    override fun onCreate() {
        super.onCreate()
        // Compose reads the view tree for a lifecycle owner, and an IME has none of its
        // own, so the service provides one and drives it from the input view callbacks.
        lifecycleRegistry.currentState = Lifecycle.State.INITIALIZED
        savedStateRegistryController.performAttach()
        savedStateRegistryController.performRestore(null)
        lifecycleRegistry.currentState = Lifecycle.State.CREATED

        loadDictionary()
    }

    /**
     * Maps the dictionary in the background.
     *
     * Opening only reads a 24-byte header and the page directory, so this is quick, but it
     * is still file I/O and the first frame of the keyboard should not wait on it.
     *
     * The result is posted back on the main dispatcher, and the scope's cancellation is
     * what stops a late result from landing on a destroyed service: once [onDestroy] cancels
     * [dictionaryScope], the `withContext` below throws and the state is never reassigned.
     */
    private fun loadDictionary() {
        dictionaryScope.launch {
            val result = runCatching { DictionaryLoader.openFromAssets(assets) }
            withContext(Dispatchers.Main) {
                result
                    .onSuccess { opened ->
                        dictionary = opened
                        session =
                            PinyinDuckSession(opened.engine, editor, settings.defaultScript)
                                .also { it.onChange = ::syncFromSession }
                        uiState =
                            uiState.copy(
                                loading = false,
                                dictionaryError = null,
                                dictionaryEntries = opened.entryCount,
                                script = settings.defaultScript,
                            )
                    }.onFailure { error ->
                        uiState = uiState.copy(loading = false, dictionaryError = describe(error))
                    }
            }
        }
    }

    override fun onCreateInputView(): View {
        val view = ComposeView(this)
        view.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
        view.setViewTreeLifecycleOwner(this)
        view.setViewTreeSavedStateRegistryOwner(this)
        view.setContent {
            PinyinDuckTheme {
                PinyinDuckKeyboard(uiState, callbacks())
            }
        }
        return view
    }

    override fun onStartInputView(
        info: EditorInfo?,
        restarting: Boolean,
    ) {
        super.onStartInputView(info, restarting)
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        super.onFinishInputView(finishingInput)
    }

    override fun onStartInput(
        info: EditorInfo?,
        restarting: Boolean,
    ) {
        super.onStartInput(info, restarting)
        // A new field means a new composition. This only clears our own state; anything
        // already committed stays in the editor.
        session?.reset()
        uiState = uiState.copy(shift = false, expanded = false, layout = KeyLayout.LETTERS)
    }

    override fun onFinishInput() {
        super.onFinishInput()
        session?.reset()
    }

    override fun onDestroy() {
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        // Cancel before closing the dictionary, so a load that is still running cannot
        // finish afterwards and hand its result to a service that no longer exists.
        dictionaryScope.cancel()
        dictionary?.close()
        dictionary = null
        session = null
        super.onDestroy()
    }

    /**
     * Hardware keyboard support.
     *
     * A physical keyboard drives the same session as the on-screen one, so the two can
     * never disagree about what a letter means. Arrow keys move the candidate selection,
     * which also makes the whole app testable over `adb shell input keyevent`.
     */
    override fun onKeyDown(
        keyCode: Int,
        event: KeyEvent,
    ): Boolean {
        val session = session ?: return super.onKeyDown(keyCode, event)

        val outcome =
            KeyRouting.route(
                keyCode = keyCode,
                unicode = event.unicodeChar.toChar(),
                shift = event.isShiftPressed,
            ) ?: return super.onKeyDown(keyCode, event)

        when (outcome) {
            is KeyRouting.Outcome.Act -> handleKey(outcome.action)
            is KeyRouting.Outcome.Move -> session.moveSelection(outcome.delta)
            is KeyRouting.Outcome.MoveByPage ->
                session.moveSelectionByPage(outcome.pages, KeyRouting.PAGE_SIZE)
            KeyRouting.Outcome.Enter -> session.enter()
            KeyRouting.Outcome.Cancel -> session.cancelComposition()
        }
        return true
    }

    /**
     * The wiring between the on-screen keyboard and the session.
     *
     * Exposed to the test so the same code path the taps take can be driven directly, rather
     * than by synthesising pointer events against the Compose tree.
     */
    internal fun callbacks() =
        KeyboardCallbacks(
            onKey = ::handleKey,
            onSelectCandidate = { session?.selectCandidate(it) },
            onToggleScript = { session?.toggleScript() },
            onToggleExpanded = { uiState = uiState.copy(expanded = !uiState.expanded) },
            onClear = { session?.cancelComposition() },
        )

    private fun handleKey(action: KeyAction) {
        val session = session ?: return
        when (action) {
            is KeyAction.Letter -> {
                session.typeLetter(action.value)
                // Shift is one-shot, the way a phone keyboard behaves.
                uiState = uiState.copy(shift = false)
            }
            is KeyAction.Digit -> session.typeDigit(action.value)
            is KeyAction.Symbol -> {
                // Punctuation cannot continue a composition, so `nihao` then `.` commits the
                // typed pinyin as text and adds the full stop, instead of dropping it.
                session.commitRawText()
                editor.commitText(action.value)
            }
            KeyAction.Backspace -> session.backspace()
            KeyAction.Space -> session.space()
            KeyAction.Enter -> session.enter()
            KeyAction.Shift -> uiState = uiState.copy(shift = !uiState.shift)
            is KeyAction.SwitchTo -> uiState = uiState.copy(layout = action.layout, shift = false)
            KeyAction.ToggleScript -> session.toggleScript()
            KeyAction.ToggleExpanded -> uiState = uiState.copy(expanded = !uiState.expanded)
            KeyAction.Clear -> session.cancelComposition()
        }
    }

    private fun syncFromSession() {
        val session = session ?: return
        uiState =
            uiState.copy(
                buffer = session.buffer,
                candidates = session.candidates,
                total = session.total,
                selectedIndex = session.selectedIndex,
                script = session.script,
            )
    }

    /** The [TextSink] that writes to whatever field is currently focused. */
    private inner class EditorSink : TextSink {
        override fun setComposingText(text: String) {
            currentInputConnection?.setComposingText(text, 1)
        }

        override fun commitText(text: String) {
            currentInputConnection?.commitText(text, 1)
        }

        override fun deleteSurrounding(
            before: Int,
            after: Int,
        ) {
            if (before == 0 && after == 0) return
            currentInputConnection?.deleteSurroundingText(before, after)
        }

        /**
         * Performs the field's own action when it declared one.
         *
         * A search box wants `IME_ACTION_SEARCH` rather than a newline, and the field's
         * `imeOptions` is the only place that says which.
         */
        override fun sendEnter() {
            val connection = currentInputConnection ?: return
            KeyRouting.editorAction(currentInputEditorInfo?.imeOptions)?.let { action ->
                connection.performEditorAction(action)
                return
            }
            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        }
    }

    private fun describe(error: Throwable): String = DictionaryErrors.describe(error)
}

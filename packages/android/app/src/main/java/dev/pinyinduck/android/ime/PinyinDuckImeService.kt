package dev.pinyinduck.android.ime

import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
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
import dev.pinyinduck.android.engine.DictionaryFormatException
import dev.pinyinduck.android.ui.KeyAction
import dev.pinyinduck.android.ui.KeyLayout
import dev.pinyinduck.android.ui.KeyboardCallbacks
import dev.pinyinduck.android.ui.PinyinDuckKeyboard
import dev.pinyinduck.android.ui.PinyinDuckTheme
import java.io.FileNotFoundException

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
class PinyinDuckImeService : InputMethodService(), LifecycleOwner, SavedStateRegistryOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateRegistryController = SavedStateRegistryController.create(this)

    private val settings by lazy { KeyboardSettings(this) }

    private var dictionary: OpenedDictionary? = null
    private var session: PinyinDuckSession? = null

    private var uiState by mutableStateOf(KeyboardUiState())

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
     */
    private fun loadDictionary() {
        val main = Handler(Looper.getMainLooper())
        Thread({
            val result = runCatching { DictionaryLoader.openFromAssets(assets) }
            main.post {
                result
                    .onSuccess { opened ->
                        dictionary = opened
                        session = PinyinDuckSession(opened.engine, editor, settings.defaultScript)
                            .also { it.onChange = ::syncFromSession }
                        uiState = uiState.copy(
                            loading = false,
                            dictionaryError = null,
                            dictionaryEntries = opened.entryCount,
                            script = settings.defaultScript,
                        )
                    }
                    .onFailure { error ->
                        uiState = uiState.copy(loading = false, dictionaryError = describe(error))
                    }
            }
        }, "pinyinduck-dictionary").start()
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

    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        super.onFinishInputView(finishingInput)
    }

    override fun onStartInput(info: EditorInfo?, restarting: Boolean) {
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
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val session = session ?: return super.onKeyDown(keyCode, event)

        when (keyCode) {
            KeyEvent.KEYCODE_SPACE -> session.space()
            KeyEvent.KEYCODE_DEL -> session.backspace()
            KeyEvent.KEYCODE_ENTER -> session.enter()
            KeyEvent.KEYCODE_ESCAPE -> session.cancelComposition()
            KeyEvent.KEYCODE_DPAD_LEFT -> session.moveSelection(-1)
            KeyEvent.KEYCODE_DPAD_RIGHT -> session.moveSelection(1)
            KeyEvent.KEYCODE_DPAD_UP -> session.moveSelectionByPage(-1, PAGE_SIZE)
            KeyEvent.KEYCODE_DPAD_DOWN -> session.moveSelectionByPage(1, PAGE_SIZE)
            else -> {
                val handled = typeFromUnicode(event.unicodeChar)
                if (!handled) return super.onKeyDown(keyCode, event)
            }
        }
        return true
    }

    /** Routes a printable character into the composition, or reports that it cannot. */
    private fun typeFromUnicode(unicode: Int): Boolean {
        val session = session ?: return false
        // apostrophe is part of pinyin: `xi'an` is 西安, not `xian`.
        if (unicode == '\''.code) {
            session.typeLetter('\'')
            return true
        }
        if (unicode !in 32..126) return false

        val char = unicode.toChar()
        return when {
            char in 'a'..'z' || char in 'A'..'Z' -> {
                session.typeLetter(char.lowercaseChar())
                true
            }
            char in '0'..'9' -> {
                session.typeDigit(char - '0')
                true
            }
            else -> false
        }
    }

    private fun callbacks() = KeyboardCallbacks(
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
        uiState = uiState.copy(
            buffer = session.buffer,
            candidates = session.candidates,
            total = session.total,
            selectedIndex = session.selectedIndex,
            script = session.script,
        )
    }

    /** The [TextSink] that writes to whatever field is currently focused. */
    private inner class EditorSink : TextSink {

        override fun commitText(text: String) {
            currentInputConnection?.commitText(text, 1)
        }

        override fun deleteSurrounding(before: Int, after: Int) {
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
            val options = currentInputEditorInfo?.imeOptions ?: return
            val action = options and EditorInfo.IME_MASK_ACTION
            if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
                connection.performEditorAction(action)
                return
            }
            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            connection.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
        }
    }

    private fun describe(error: Throwable): String = when {
        error is FileNotFoundException && error.message?.contains("compressed") == true ->
            "The dictionary asset is compressed. It must ship uncompressed to be mmapped; " +
                "check the noCompress setting in app/build.gradle.kts."

        error is FileNotFoundException ->
            "dictionary.btree is missing from the app. Run \"npm run build:dict\" at the " +
                "repository root and rebuild."

        error is DictionaryFormatException ->
            "The dictionary is unreadable (${error.message}). Run \"npm run build:dict\" to regenerate it."

        else ->
            "The dictionary could not be opened: ${error.message ?: error.javaClass.simpleName}"
    }

    private companion object {
        /** Candidates moved per Up/Down press on a hardware keyboard. */
        const val PAGE_SIZE = 9
    }
}

package dev.pinyinduck.android.ime

import android.content.res.AssetManager
import android.inputmethodservice.InputMethodService
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.data.OpenedDictionary
import dev.pinyinduck.android.ui.KeyAction
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
    SavedStateRegistryOwner,
    ViewModelStoreOwner {
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

    /**
     * How [loadDictionary] opens the dictionary, run on [dictionaryScope]'s IO thread.
     *
     * `internal` so `PinyinDuckImeServiceTest` can hold the load open. Robolectric drains the
     * main looper inside `ServiceController.create()`, so on a fast machine a real load lands
     * before the test's first line and "the dictionary is still loading" becomes a race the
     * test loses. Set it before `create()`; it is read once, in [onCreate].
     */
    internal var openDictionary: (AssetManager) -> OpenedDictionary = { DictionaryLoader.openFromAssets(it) }

    // `internal` rather than `private` so `PinyinDuckImeServiceTest` can assert on the state
    // the wiring produces. This is the app's only entry point, and it is where a broken
    // reference to the session or a mis-wired callback would show up; leaving it untested
    // would mean the only untested class is the one the user actually runs.
    internal var session: PinyinDuckSession? = null

    internal var uiState by mutableStateOf(KeyboardUiState())

    override val lifecycle: Lifecycle get() = lifecycleRegistry

    override val savedStateRegistry: SavedStateRegistry get() = savedStateRegistryController.savedStateRegistry

    /**
     * Cleared in [onDestroy] alongside the lifecycle, since nothing outlives the service.
     *
     * Named `store` because the interface property is [viewModelStore], and the two cannot share
     * a name in Kotlin.
     */
    private val store = ViewModelStore()

    override val viewModelStore: ViewModelStore get() = store

    /** Reaches the field the user is typing into. */
    private val editor = EditorSink()

    /**
     * How the current field is typed into, from its `inputType`.
     *
     * `internal` for the same reason as [session]: the test asserts each class of field gets
     * the right one.
     */
    internal var fieldPolicy = FieldPolicy.PINYIN
        private set

    override fun onCreate() {
        super.onCreate()
        // Compose reads the view tree for a lifecycle owner, and an IME has none of its
        // own, so the service provides one and drives it from the input view callbacks.
        lifecycleRegistry.currentState = Lifecycle.State.INITIALIZED
        savedStateRegistryController.performAttach()
        savedStateRegistryController.performRestore(null)
        lifecycleRegistry.currentState = Lifecycle.State.CREATED

        // Built here, before the dictionary arrives, and not down in `loadDictionary` where
        // it used to be created. Mapping the dictionary is real I/O on a background thread,
        // and on a cold start the keyboard is on screen and being tapped well before it
        // finishes — so a session created only at the end of the load would not exist for
        // the first keystrokes, and every input path guarded on it (`session ?: return`)
        // would swallow them. The keyboard appeared dead: input eaten, no candidates,
        // nothing typeable until the load happened to land.
        //
        // The session is a pure state machine and only the *engine* needs the dictionary, so
        // nothing is lost by starting without one. `onDictionaryReady` hands it over below.
        session =
            PinyinDuckSession(editor, settings.defaultScript).also {
                it.onChange = ::syncFromSession
            }
        // Seeds the script from the preference the session was just built with, so the
        // composition bar does not claim simplified until the first keystroke.
        syncFromSession()

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
            val result = runCatching { openDictionary(assets) }
            withContext(Dispatchers.Main) {
                result
                    .onSuccess { opened ->
                        dictionary = opened
                        // Hands the engine to the session that has existed since `onCreate`,
                        // which also ranks anything typed while the load was in flight. The
                        // `script` is deliberately not re-applied from the preference here:
                        // the session owns it, and the toggle is live during the load, so
                        // re-reading the setting would silently undo the user's own choice.
                        session?.onDictionaryReady(opened.engine)
                        uiState =
                            uiState.copy(
                                loading = false,
                                dictionaryError = null,
                                dictionaryEntries = opened.entryCount,
                            )
                    }.onFailure { error ->
                        // The session is left in place without an engine, which is what makes
                        // this a degraded keyboard rather than a dead one: letters still
                        // reach the editor and space commits the raw pinyin.
                        uiState = uiState.copy(loading = false, dictionaryError = describe(error))
                    }
            }
        }
    }

    override fun onCreateInputView(): View {
        installViewTreeOwners()

        val view = ComposeView(this)
        view.setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
        view.setContent {
            PinyinDuckTheme {
                PinyinDuckKeyboard(uiState, callbacks())
            }
        }
        // A new input view has not been laid out, so whatever the old one reported is stale.
        keyboardTop = null
        inputRoot = view
        return view
    }

    override fun setInputView(view: View) {
        super.setInputView(view)
        applyFullHeightLayout()
    }

    /**
     * Re-applies the full-height window after the framework has reset it.
     *
     * `InputMethodService.onConfigureWindow` puts the window back to `WRAP_CONTENT` every time
     * fullscreen mode is re-evaluated, which happens on configuration changes and input
     * starts, so setting the height once at startup does not stick. LatinIME overrides this
     * method for the same reason.
     */
    override fun updateFullscreenMode() {
        super.updateFullscreenMode()
        applyFullHeightLayout()
    }

    /**
     * Makes the IME window, the framework's `inputArea` frame and the input view fill the screen.
     *
     * The Candidate detail bubble is an ordinary composable drawn above the keyboard in this
     * same window, so the window has to be tall enough to hold it. The part above the keyboard
     * is transparent (the theme) and passes touches to the app ([onComputeInsets]), and the
     * keyboard is bottom-aligned inside it, so to the user nothing changes until the bubble
     * opens. `inputArea` and the input view are bottom-aligned as well, so if anything ever
     * measures them shorter than the window the keyboard still sits on the bottom edge.
     */
    private fun applyFullHeightLayout() {
        val window = window?.window ?: return
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        window.findViewById<View>(android.R.id.inputArea)?.let(::fillHeightAtBottom)
        inputRoot?.let(::fillHeightAtBottom)
    }

    /**
     * Sets a view's height to `MATCH_PARENT` and its gravity to the bottom.
     *
     * The framework parents `inputArea` in a `LinearLayout` and the input view in a
     * `FrameLayout`, and the two spell gravity on different `LayoutParams` classes.
     */
    private fun fillHeightAtBottom(view: View) {
        val params = view.layoutParams ?: return
        params.height = ViewGroup.LayoutParams.MATCH_PARENT
        when (params) {
            is LinearLayout.LayoutParams -> params.gravity = Gravity.BOTTOM
            is FrameLayout.LayoutParams -> params.gravity = Gravity.BOTTOM
        }
        view.layoutParams = params
    }

    /**
     * The input view, which fills the whole IME window (see [applyFullHeightLayout]).
     *
     * Its size is the window frame [onComputeInsets] reports against.
     */
    private var inputRoot: View? = null

    /**
     * The keyboard's top edge in window pixels, or null before the keyboard has been laid out.
     *
     * Reported from the composition through [onKeyboardTop]. A plain field rather than Compose
     * state: it feeds the insets, which the window recomputes on its own on every traversal, and
     * nothing in the composition should recompose because it moved.
     */
    private var keyboardTop: Int? = null

    /**
     * Records where the keyboard's top landed, in window pixels.
     *
     * `internal` so the composition can report it and the test can stand in for a layout
     * Robolectric never performs.
     */
    internal fun onKeyboardTop(top: Int) {
        keyboardTop = top
    }

    /**
     * Tells the window manager the keyboard covers only itself, not the full-height window.
     *
     * The rules are in [ImeInsets]; this only measures the window and copies the result into
     * the framework's [Insets]. The framework calls this on every traversal and pushes it to
     * the window manager only when it changed, so opening or closing the bubble, which changes
     * the layout, is enough to move the touchable region.
     */
    override fun onComputeInsets(outInsets: Insets) {
        super.onComputeInsets(outInsets)
        val root = inputRoot
        val bottom =
            if (root == null || root.height == 0) {
                0
            } else {
                val location = IntArray(2)
                root.getLocationInWindow(location)
                location[1] + root.height
            }
        val frame =
            ImeWindowFrame(
                width = root?.width ?: 0,
                bottom = bottom,
                fallbackBottom = resources.displayMetrics.heightPixels,
            )
        val spec = ImeInsets.compute(frame, keyboardTop, bubbleOpen = uiState.detailOpen)
        outInsets.contentTopInsets = spec.contentTop
        outInsets.visibleTopInsets = spec.visibleTop
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_REGION
        with(spec.touchable) { outInsets.touchableRegion.set(left, top, right, bottom) }
    }

    /**
     * Publishes the owners Compose resolves on the IME window's decor view.
     *
     * `ComponentActivity.setContent` does this for an activity, and Compose's
     * `AbstractComposeView` walks *up* the parent chain looking for them, starting from the
     * window. An `InputMethodService` is not a `ComponentActivity`, so it has to install them
     * itself; nothing does it on our behalf.
     *
     * This has to be the decor view rather than the `ComposeView` itself. Setting them on the
     * `ComposeView` compiles, passes every test, and still crashes on device the moment the
     * input view is attached:
     *
     * ```
     * IllegalStateException: ViewTreeLifecycleOwner not found from android.widget.LinearLayout
     *   ... #10204a4 android:id/parentPanel
     *   at AbstractComposeView.onAttachedToWindow(ComposeView.android.kt)
     * ```
     *
     * The `parentPanel` in that message is a frame of the IME window, not the `ComposeView` that
     * was tagged — the lookup had already walked past it. Robolectric never attaches the input
     * view to a real window, so no unit test can see this, which is why it is written down here.
     */
    private fun installViewTreeOwners() {
        val decorView = window?.window?.decorView ?: return
        decorView.setViewTreeLifecycleOwner(this)
        decorView.setViewTreeViewModelStoreOwner(this)
        decorView.setViewTreeSavedStateRegistryOwner(this)
    }

    /**
     * Never fullscreen (extract) mode, in any orientation.
     *
     * The framework default goes fullscreen on a landscape editor, and in that mode the input
     * view is laid out `WRAP_CONTENT` under the extract text area, which leaves the Candidate
     * detail bubble no room above the keyboard. Decided on #11: landscape behaves like
     * portrait, at the cost of a shorter app area on landscape phones, and no setting brings
     * extract mode back.
     */
    override fun onEvaluateFullscreenMode(): Boolean = false

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
        // The field's type decides whether keys compose at all and which page opens: a
        // password must never pass through composition, and a phone field wants digits.
        fieldPolicy = FieldPolicy.forInputType(info?.inputType ?: 0)
        session?.direct = fieldPolicy.direct
        uiState = uiState.copy(shift = false, expanded = false, layout = fieldPolicy.layout)
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
        // Cleared last, so anything the dictionary or session teardown triggers can still reach
        // it. Compose observes the lifecycle above and disposes with it.
        store.clear()
        super.onDestroy()
    }

    /**
     * Hardware keyboard support.
     *
     * A physical keyboard drives the same session as the on-screen one, so the two can
     * never disagree about what a letter means. Arrow keys move the candidate selection,
     * which also makes the whole app testable over `adb shell input keyevent`.
     *
     * Both input paths share one session and one null guard, and the guard is only ever
     * reached between [onDestroy] clearing it and the window closing. It used to double as
     * the startup path: with the session created at the end of the dictionary load, a
     * hardware key pressed before that was passed on to the app as raw text and bypassed
     * the engine entirely, while the same key on the on-screen keyboard was swallowed. The
     * two disagreed about the same letter depending on which keyboard produced it.
     */
    override fun onKeyDown(
        keyCode: Int,
        event: KeyEvent,
    ): Boolean {
        val session = session ?: return super.onKeyDown(keyCode, event)
        // In a password, email or number field the keyboard has nothing to compose, so a
        // physical key goes to the app untouched, with its own case, repeat and modifiers.
        // Routing it through the session instead would lowercase a shifted letter.
        if (fieldPolicy.direct) return super.onKeyDown(keyCode, event)

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
     *
     * A tap is consumed by the Compose key the moment it lands, so a callback that quietly
     * did nothing would erase the keystroke with nothing left to show for it. The session is
     * therefore built in [onCreate] and exists before the first tap can arrive, and the
     * `?.` here is only ever live once [onDestroy] has cleared it.
     */
    internal fun callbacks() =
        KeyboardCallbacks(
            onKey = ::handleKey,
            onSelectCandidate = { session?.selectCandidate(it) },
            onToggleScript = { session?.toggleScript() },
            onToggleExpanded = { uiState = uiState.copy(expanded = !uiState.expanded) },
            onClear = { session?.cancelComposition() },
            onShowDetail = { uiState = uiState.copy(detailIndex = it) },
            onCloseDetail = ::closeDetail,
        )

    /** Closes the Candidate detail bubble; a no-op when it is already closed. */
    private fun closeDetail() {
        if (uiState.detailOpen) uiState = uiState.copy(detailIndex = null)
    }

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

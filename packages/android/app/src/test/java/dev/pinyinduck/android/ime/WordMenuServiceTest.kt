package dev.pinyinduck.android.ime

import android.os.Looper
import android.view.KeyEvent
import dev.pinyinduck.android.data.DictionaryLoader
import dev.pinyinduck.android.ui.KeyAction
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config

/**
 * The word menu of a Sentence candidate's card in the Expanded candidate list, as the service
 * drives it (#47, decided on #37): what opens and closes it, and what its chips do. What the
 * swap and the commit-through do to the composition is `PinyinDuckSessionTest`'s; how the menu
 * is drawn and reached is `SentenceCandidateTest`'s.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp")
class WordMenuServiceTest {
    private lateinit var controller: ServiceController<PinyinDuckImeService>
    private val service get() = controller.get()

    @Before
    fun setUp() {
        controller = Robolectric.buildService(PinyinDuckImeService::class.java)
        controller.get().openDictionary = { DictionaryLoader.openFromAssets(it) }
        controller.create()
        awaitDictionary()
        type("woxianghekafei")
        service.callbacks().onToggleExpanded()
    }

    @After
    fun tearDown() {
        controller.destroy()
    }

    @Test
    fun tappingAWordOpensItsMenuWithTheAlternativesOnItsSpan() {
        service.callbacks().onOpenWordMenu(0, 2)

        val menu = assertNotNull(service.uiState.wordMenu)
        assertEquals(0, menu.index)
        assertEquals(2, menu.word)
        assertTrue("和 is not among ${menu.alternatives.map { it.hanzi }}", menu.alternatives.any { it.hanzi == "和" })
    }

    @Test
    fun tappingTheSameWordAgainClosesTheMenuAndAnotherWordSwitchesIt() {
        service.callbacks().onOpenWordMenu(0, 2)
        service.callbacks().onOpenWordMenu(0, 3)
        assertEquals(3, service.uiState.wordMenu?.word)

        service.callbacks().onOpenWordMenu(0, 3)

        assertNull(service.uiState.wordMenu)
    }

    @Test
    fun theMenuAndTheDetailAreNeverOpenTogether() {
        service.callbacks().onShowWordDetail(0, 1)
        service.callbacks().onOpenWordMenu(0, 2)
        assertFalse(service.uiState.detailOpen)

        service.callbacks().onShowWordDetail(0, 1)

        assertNull(service.uiState.wordMenu)
        assertTrue(service.uiState.detailOpen)
    }

    @Test
    fun choosingAnAlternativeRebuildsTheSentenceAroundItAndClosesTheMenu() {
        service.callbacks().onOpenWordMenu(0, 2)
        val and =
            service.uiState.wordMenu!!
                .alternatives
                .first { it.hanzi == "和" }

        service.callbacks().onSwapWord(and)

        assertEquals(
            "我想和咖啡",
            service.uiState.candidates
                .first()
                .hanzi,
        )
        assertEquals(0, service.uiState.selectedIndex)
        assertNull(service.uiState.wordMenu)
        assertTrue("the list stays open", service.uiState.expanded)
        assertEquals(listOf("和"), service.uiState.fixedWords.map { it.simplified })
    }

    @Test
    fun committingThroughAWordLeavesTheRestComposing() {
        service.callbacks().onOpenWordMenu(0, 1)

        service.callbacks().onCommitThrough(0, 1)

        assertEquals("hekafei", service.uiState.buffer)
        assertNull(service.uiState.wordMenu)
    }

    @Test
    fun typingOnClosesTheMenu() {
        service.callbacks().onOpenWordMenu(0, 2)

        service.callbacks().onKey(KeyAction.Letter('r'))

        assertNull(service.uiState.wordMenu)
    }

    @Test
    fun collapsingTheListClosesTheMenu() {
        service.callbacks().onOpenWordMenu(0, 2)

        service.callbacks().onToggleExpanded()

        assertNull(service.uiState.wordMenu)
    }

    @Test
    fun backWhileTheMenuIsOpenIsConsumedAndOnlyClosesIt() {
        swapHeForAnd()
        service.callbacks().onOpenWordMenu(0, 3)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK)))
        assertTrue(service.onKeyUp(KeyEvent.KEYCODE_BACK, keyEvent(KeyEvent.KEYCODE_BACK, action = KeyEvent.ACTION_UP)))

        assertNull(service.uiState.wordMenu)
        assertEquals(
            "我想和咖啡",
            service.uiState.candidates
                .first()
                .hanzi,
        )
    }

    @Test
    fun puttingTheKeyboardAwayWithBackDropsTheFixedWordsButKeepsTheComposition() {
        swapHeForAnd()

        // With nothing open, Back is the framework's: it hides the keyboard.
        service.onWindowHidden()

        assertEquals("woxianghekafei", service.uiState.buffer)
        assertEquals(emptyList<Any>(), service.uiState.fixedWords)
        assertEquals(
            "我想喝咖啡",
            service.uiState.candidates
                .first()
                .hanzi,
        )
    }

    @Test
    fun escapeClosesTheMenuFirstAndThenCancelsDroppingTheFixedWords() {
        swapHeForAnd()
        service.callbacks().onOpenWordMenu(0, 3)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, keyEvent(KeyEvent.KEYCODE_ESCAPE)))
        assertNull(service.uiState.wordMenu)
        assertEquals("woxianghekafei", service.uiState.buffer)

        assertTrue(service.onKeyDown(KeyEvent.KEYCODE_ESCAPE, keyEvent(KeyEvent.KEYCODE_ESCAPE)))
        assertEquals("", service.uiState.buffer)
        assertEquals(emptyList<Any>(), service.uiState.fixedWords)
    }

    @Test
    fun aWordWithNoBlockOpensNoMenu() {
        service.callbacks().onOpenWordMenu(0, 4)
        service.callbacks().onOpenWordMenu(1, 0)

        assertNull(service.uiState.wordMenu)
    }

    private fun swapHeForAnd() {
        service.callbacks().onOpenWordMenu(0, 2)
        service.callbacks().onSwapWord(
            service.uiState.wordMenu!!
                .alternatives
                .first { it.hanzi == "和" },
        )
        assertEquals(
            "我想和咖啡",
            service.uiState.candidates
                .first()
                .hanzi,
        )
    }

    // --- helpers ------------------------------------------------------------------

    private fun type(text: String) =
        text.forEach { letter ->
            val keyCode = KeyEvent.KEYCODE_A + (letter - 'a')
            assertTrue(service.onKeyDown(keyCode, keyEvent(keyCode, letter)))
        }

    /** A hardware key press; see `PinyinDuckImeServiceTest.unowned` for why it is subclassed. */
    private fun keyEvent(
        keyCode: Int,
        unicode: Char = 0.toChar(),
        action: Int = KeyEvent.ACTION_DOWN,
    ) = object : KeyEvent(0L, 0L, action, keyCode, 0, 0) {
        override fun getUnicodeChar(): Int = unicode.code

        override fun getUnicodeChar(metaState: Int): Int = unicode.code
    }

    private fun awaitDictionary(timeoutMillis: Long = 30_000) {
        val main = shadowOf(Looper.getMainLooper())
        val deadline = System.nanoTime() + timeoutMillis * 1_000_000L
        while (service.uiState.loading && System.nanoTime() < deadline) {
            main.idle()
            Thread.sleep(5)
        }
        main.idle()
        assertFalse("the dictionary did not load", service.uiState.loading)
    }

    private fun <T : Any> assertNotNull(value: T?): T {
        assertNotNull("expected a value", value)
        return value!!
    }
}

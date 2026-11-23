package dev.pinyinduck.android

import android.content.Intent
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import dev.pinyinduck.android.ui.SENTENCE_SLOT_TAG

/** PinyinDuck's package, which every search on the keyboard is scoped to. */
const val PACKAGE = "dev.pinyinduck.android"

const val TIMEOUT_MS = 20_000L
const val SHORT_TIMEOUT_MS = 5_000L

/**
 * Drives the PinyinDuck keyboard from outside, as a user would: opens a field in another app,
 * taps keys, and finds elements of the keyboard.
 *
 * Every search is scoped to PinyinDuck's package: the keyboard's window never takes focus, so
 * an unscoped search would look in Settings first. Keys are found by their label text; tagged
 * elements by their test tag, which `KeyboardWindow` exposes as a resource id.
 */
class KeyboardDriver {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device: UiDevice = UiDevice.getInstance(instrumentation)

    /**
     * Opens Settings search with an empty field and PinyinDuck up and loaded.
     *
     * Settings search ships on every system image and needs no setup. Opening it clears the
     * task, so the field starts empty. The field is looked up again whenever it is read
     * ([fieldText]) rather than held, since a test may reopen it.
     */
    fun openSettingsSearch() {
        // From the home screen, so the field found below is never the one from before.
        device.pressHome()
        if (!device.wait(Until.gone(SEARCH_FIELD), TIMEOUT_MS)) failTest("The previous Settings search did not close")
        val intent =
            Intent(SEARCH_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        instrumentation.targetContext.startActivity(intent)

        val field =
            device.wait(Until.findObject(SEARCH_FIELD), TIMEOUT_MS)
                ?: failTest("Settings search did not open its search field")

        // Settings search focuses its field and raises the keyboard by itself; tap if not.
        if (!device.wait(Until.hasObject(By.pkg(PACKAGE)), SHORT_TIMEOUT_MS)) {
            field.click()
            if (!device.wait(Until.hasObject(By.pkg(PACKAGE)), TIMEOUT_MS)) {
                failTest("The PinyinDuck keyboard did not appear")
            }
        }
        if (!device.wait(Until.gone(onKeyboard().text(LOADING_DICTIONARY)), TIMEOUT_MS)) {
            failTest("The PinyinDuck keyboard still shows \"$LOADING_DICTIONARY\" after ${TIMEOUT_MS / 1000} s")
        }
        device.waitForIdle()
    }

    /** The whole screen, in screen pixels. */
    fun screenBounds(): Rect = Rect(0, 0, device.displayWidth, device.displayHeight)

    /** Presses the system Back button. */
    fun pressBack() {
        device.pressBack()
    }

    /** Fails unless the PinyinDuck keyboard leaves the screen, as after [what]. */
    fun assertKeyboardHides(what: String) {
        if (!device.wait(Until.gone(onKeyboard()), TIMEOUT_MS)) failTest("$what did not hide the PinyinDuck keyboard")
    }

    /** What the search field holds now, composing text included. */
    fun fieldText(): String? = device.findObject(SEARCH_FIELD)?.text

    /** Waits until the search field holds [text], and fails saying what it holds if it never does. */
    fun waitForFieldText(text: String) {
        if (!device.wait(Until.hasObject(SEARCH_FIELD.text(text)), TIMEOUT_MS)) {
            failTest("Expected the field to hold \"$text\" but it holds \"${fieldText()}\"")
        }
    }

    /**
     * Fails if the search field leaves the screen within [SHORT_TIMEOUT_MS], as it does when
     * the app has handled a key the keyboard should have kept ([what] names that key).
     */
    fun assertSearchFieldStays(what: String) {
        if (device.wait(Until.gone(SEARCH_FIELD), SHORT_TIMEOUT_MS)) failTest("Settings search closed after $what")
    }

    /**
     * Drops the composition with the keyboard's ✕ button, back to the state before typing,
     * and waits until the field no longer holds [pinyin].
     */
    fun clearComposition(pinyin: String) {
        device.findObject(onKeyboard().text("✕"))?.click() ?: failTest("No ✕ button on the PinyinDuck keyboard")
        if (!device.wait(Until.gone(SEARCH_FIELD.text(pinyin)), TIMEOUT_MS)) {
            failTest("✕ did not clear \"$pinyin\" from the field")
        }
        device.waitForIdle()
    }

    /**
     * Puts [text] in the search field with the cursor at its end, as pasted text would be,
     * and waits until the field holds it.
     */
    fun setFieldText(text: String) {
        val field = device.findObject(SEARCH_FIELD) ?: failTest("No search field to put \"$text\" in")
        field.text = text
        waitForFieldText(text)
        device.waitForIdle()
    }

    /**
     * Selects the [length] characters that end [fromEnd] characters before the end of the
     * field's text, with the accessibility action `ACTION_SET_SELECTION` on the field, then
     * fails unless the field reports exactly that selection.
     *
     * Hardware key events (Shift+Left) did not move the selection on the emulator, and a long
     * press selects a word rather than a range, so the field is asked directly.
     */
    fun selectInField(
        fromEnd: Int,
        length: Int,
    ) {
        val text = fieldText() ?: failTest("No search field to select in")
        val start = text.length - fromEnd - length
        val end = text.length - fromEnd
        val args =
            Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, start)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, end)
            }
        if (!searchFieldNode().performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, args)) {
            failTest("The field refused to select $start..$end in \"$text\"")
        }
        device.waitForIdle()
        val selected = searchFieldNode().let { it.textSelectionStart to it.textSelectionEnd }
        if (selected != start to end) failTest("Expected the selection $start..$end in \"$text\" but the field has $selected")
    }

    private fun searchFieldNode(): AccessibilityNodeInfo =
        instrumentation.uiAutomation.rootInActiveWindow
            ?.findAccessibilityNodeInfosByViewId("android:id/search_src_text")
            ?.firstOrNull()
            ?: failTest("No search field to select in")

    /**
     * Types [pinyin] on PinyinDuck's keys and waits until the field holds [fieldTextWhileComposing],
     * which is the pinyin itself unless the field had other text around it.
     */
    fun type(
        pinyin: String,
        fieldTextWhileComposing: String = pinyin,
    ) {
        pinyin.forEach { tapKey(it.toString()) }
        waitForFieldText(fieldTextWhileComposing)
        device.waitForIdle()
    }

    /**
     * Taps the key labelled [label].
     *
     * The strip can show a candidate whose text is a single letter too, so the lowest match on
     * screen is taken: keys sit below the strip.
     */
    fun tapKey(label: String) {
        val key =
            device
                .findObjects(onKeyboard().text(label))
                .maxByOrNull { it.visibleBounds.top }
                ?: failTest("No \"$label\" key on the PinyinDuck keyboard")
        key.click()
    }

    /** The keyboard's element tagged [tag], waiting for it to appear. */
    fun waitForTag(tag: String): UiObject2 =
        device.wait(Until.findObject(byTag(tag)), TIMEOUT_MS)
            ?: failTest("Nothing tagged \"$tag\" appeared on the PinyinDuck keyboard")

    /** Fails unless the keyboard's element tagged [tag] leaves the screen, as after [what]. */
    fun assertTagGoes(
        tag: String,
        what: String,
    ) {
        if (!device.wait(Until.gone(byTag(tag)), TIMEOUT_MS)) failTest("\"$tag\" is still on the keyboard after $what")
    }

    /**
     * Fails if anything tagged [tag] is on the keyboard now or appears within
     * [SHORT_TIMEOUT_MS], so a late arrival is caught too. [why] says why it should be absent.
     */
    fun assertTagStaysAway(
        tag: String,
        why: String,
    ) {
        if (device.wait(Until.hasObject(byTag(tag)), SHORT_TIMEOUT_MS)) failTest("$why, but \"$tag\" is on the keyboard")
    }

    /** Waits for an element of the keyboard whose text is [text], failing with [why] if none appears. */
    fun waitForText(
        text: String,
        why: String,
    ): UiObject2 = device.wait(Until.findObject(onKeyboard().text(text)), TIMEOUT_MS) ?: failTest(why)

    /** Taps the element of the keyboard whose text is exactly [text], failing with [why] if there is none. */
    fun tapText(
        text: String,
        why: String,
    ) {
        waitForText(text, why).click()
    }

    /** Waits for an element of the keyboard whose text contains [part], failing with [why] if none appears. */
    fun waitForTextContaining(
        part: String,
        why: String,
    ): UiObject2 = device.wait(Until.findObject(onKeyboard().textContains(part)), TIMEOUT_MS) ?: failTest(why)

    /** Fails if an element of the keyboard has text exactly [text] now or within [SHORT_TIMEOUT_MS]. */
    fun assertTextStaysAway(
        text: String,
        why: String,
    ) {
        if (device.wait(Until.hasObject(onKeyboard().text(text)), SHORT_TIMEOUT_MS)) failTest("$why, but \"$text\" is on the keyboard")
    }

    /**
     * Waits for the Sentence candidate whose content description starts with [description]
     * for [input]. If it never comes, fails saying what the strip's Sentence slot shows
     * instead: the dictionary or ranking has changed, and the test needs a new input.
     */
    fun waitForSentence(
        input: String,
        description: String,
    ): UiObject2 =
        device.wait(Until.findObject(onKeyboard().descStartsWith(description)), TIMEOUT_MS)
            ?: failTest(
                "No Sentence candidate described as \"$description…\" for \"$input\": the Sentence slot says " +
                    "\"${sentenceSlotDescription()}\". The dictionary or ranking has changed; pick a new input.",
            )

    /** The content description of the strip's Sentence slot, or null when there is none. */
    private fun sentenceSlotDescription(): String? =
        findTag(SENTENCE_SLOT_TAG)
            ?.let { slot -> if (slot.contentDescription != null) slot else slot.findObject(By.descStartsWith("Sentence ")) }
            ?.contentDescription

    /** The scrollable element of the keyboard that holds the element tagged [tag]. */
    fun scrollableHolding(tag: String): UiObject2 =
        device.findObject(onKeyboard().scrollable(true).hasDescendant(byTag(tag)))
            ?: failTest("Nothing scrollable on the PinyinDuck keyboard holds \"$tag\"")

    /** The keyboard's element tagged [tag], or null when there is none on screen now. */
    fun findTag(tag: String): UiObject2? = device.findObject(byTag(tag))

    /** Everything tagged [tag] under [parent], or on the whole keyboard. */
    fun findAllTagged(
        tag: String,
        parent: UiObject2? = null,
    ): List<UiObject2> = parent?.findObjects(byTag(tag)) ?: device.findObjects(byTag(tag))

    /** Selects the keyboard's element tagged [tag]. */
    private fun byTag(tag: String): BySelector = onKeyboard().res(tag)

    private fun onKeyboard(): BySelector = By.pkg(PACKAGE)

    private companion object {
        const val SEARCH_SETTINGS = "android.settings.APP_SEARCH_SETTINGS"

        const val LOADING_DICTIONARY = "Loading dictionary…"

        // An AutoCompleteTextView, not an EditText, so it is matched by id rather than class.
        val SEARCH_FIELD: BySelector get() = By.res("android", "search_src_text")
    }
}

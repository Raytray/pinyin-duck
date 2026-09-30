package dev.pinyinduck.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Key layout construction.
 *
 * The layouts are data rather than nested views, so these assertions pin the properties the
 * UI depends on: a way back to letters from every layer, the keys a keyboard must always
 * offer, and shift that only ever changes a letter's case without moving it.
 */
class KeysTest {
    private fun actions(
        layout: KeyLayout,
        shift: Boolean = false,
    ): List<KeyAction> = keyRows(layout, shift).flatten().map { it.action }

    @Test
    fun theNumberLayerOffersAWayBackToLetters() {
        // Getting stranded on the numbers or symbols page would be unrecoverable.
        for (layout in listOf(KeyLayout.NUMBERS, KeyLayout.SYMBOLS)) {
            assertTrue(
                "$layout has no key back to letters",
                actions(layout).any { it is KeyAction.SwitchTo && it.layout == KeyLayout.LETTERS },
            )
        }
    }

    @Test
    fun everyLayerOffersSpaceEnterAndBackspace() {
        for (layout in KeyLayout.entries) {
            val actions = actions(layout)
            assertTrue("$layout is missing space", actions.any { it is KeyAction.Space })
            assertTrue("$layout is missing enter", actions.any { it is KeyAction.Enter })
            assertTrue("$layout is missing backspace", actions.any { it is KeyAction.Backspace })
        }
    }

    @Test
    fun everyLayerIsReachableFromEveryOtherLayer() {
        // The layer switch keys are direct hops, so reachability is transitive closure rather
        // than a single hop. A user must never be stranded on a layer with no way onward.
        fun reachable(from: KeyLayout): Set<KeyLayout> {
            val seen = mutableSetOf(from)
            var changed = true
            while (changed) {
                changed = false
                for (layer in seen.toList()) {
                    for (action in actions(layer)) {
                        if (action is KeyAction.SwitchTo && seen.add(action.layout)) changed = true
                    }
                }
            }
            return seen
        }

        for (from in KeyLayout.entries) {
            assertEquals("every layer should be reachable from $from", KeyLayout.entries.toSet(), reachable(from))
        }
    }

    @Test
    fun shiftChangesTheCaseOfALetterWithoutMovingIt() {
        val lower = actions(KeyLayout.LETTERS, shift = false).filterIsInstance<KeyAction.Letter>()
        val upper = actions(KeyLayout.LETTERS, shift = true).filterIsInstance<KeyAction.Letter>()

        assertTrue("expected letters in the layout", lower.isNotEmpty())
        assertEquals("shift must not add or remove keys", lower.size, upper.size)
        assertTrue("shifted letters must be upper case", upper.all { it.value.isUpperCase() })
        // Order has to survive a shift, or a shifted tap would commit the wrong syllable.
        assertEquals(lower.map { it.value.lowercaseChar() }, upper.map { it.value.lowercaseChar() })
    }

    @Test
    fun shiftNeverAffectsDigitsOrSymbols() {
        for (layout in listOf(KeyLayout.NUMBERS, KeyLayout.SYMBOLS)) {
            assertEquals(actions(layout, shift = false), actions(layout, shift = true))
        }
    }

    @Test
    fun digitsAreTypedAsDigitsRatherThanLetters() {
        val digits = actions(KeyLayout.NUMBERS).filterIsInstance<KeyAction.Digit>()
        // Reading order, which is how the keys are laid out: 1 through 0, not 0 through 9.
        assertEquals(listOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 0), digits.map { it.value })
    }

    @Test
    fun everyRowIsNonEmpty() {
        for (layout in KeyLayout.entries) {
            keyRows(layout, shift = false).forEachIndexed { index, row ->
                assertTrue("$layout row $index is empty", row.isNotEmpty())
            }
        }
    }

    @Test
    fun theBottomRowAlwaysCarriesTheCoreKeys() {
        // The last row is what a thumb rests on, so these four are pinned to it rather than
        // allowed to move around between layers.
        for (layout in KeyLayout.entries) {
            val bottom = keyRows(layout, shift = false).last().map { it.action }
            assertTrue("$layout bottom row lost space", bottom.any { it is KeyAction.Space })
            assertTrue("$layout bottom row lost enter", bottom.any { it is KeyAction.Enter })
        }
    }
}

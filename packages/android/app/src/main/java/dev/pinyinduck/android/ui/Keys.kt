package dev.pinyinduck.android.ui

/** The three keyboard layers, toggled with the ?123 key. */
enum class KeyLayout { LETTERS, NUMBERS, SYMBOLS }

/** What a key does when tapped. */
sealed interface KeyAction {
    /** A pinyin letter, which starts or extends a composition. */
    data class Letter(
        val value: Char,
    ) : KeyAction

    /** A digit: a tone number while composing, plain text otherwise. */
    data class Digit(
        val value: Int,
    ) : KeyAction

    /** Punctuation and other non-pinyin text. */
    data class Symbol(
        val value: String,
    ) : KeyAction

    data object Backspace : KeyAction

    data object Space : KeyAction

    data object Enter : KeyAction

    data object Shift : KeyAction

    /**
     * Jump to a named layer.
     *
     * Explicit rather than a single "next layer" toggle, because the switch keys sit in two
     * places: the bottom row walks LETTERS → NUMBERS → SYMBOLS while the row above offers a
     * direct hop back to letters.
     */
    data class SwitchTo(
        val layout: KeyLayout,
    ) : KeyAction

    data object ToggleScript : KeyAction

    data object ToggleExpanded : KeyAction

    data object Clear : KeyAction
}

/** How a key is drawn, which is the only difference between a letter and an Enter key. */
enum class KeyStyle { NORMAL, SPECIAL, ACCENT }

/**
 * One key.
 *
 * [width] is in units of a normal key, so a row of letters sums to about the same as a row
 * that has to hold a shift key and a backspace key.
 */
data class KeySpec(
    val action: KeyAction,
    val label: String,
    val style: KeyStyle = KeyStyle.NORMAL,
    val width: Float = 1f,
)

private fun lettersOf(
    row: String,
    shift: Boolean,
): List<KeySpec> =
    row.map { char ->
        // The session lowercases the query before searching, so an upper-case letter is
        // safe to pass straight through.
        val letter = if (shift) char.uppercaseChar() else char
        KeySpec(KeyAction.Letter(letter), letter.toString())
    }

private fun symbolsOf(row: String): List<KeySpec> = row.map { KeySpec(KeyAction.Symbol(it.toString()), it.toString()) }

private fun digitsOf(row: String): List<KeySpec> = row.map { char -> KeySpec(KeyAction.Digit(char - '0'), char.toString()) }

/**
 * Builds the rows for a layer.
 *
 * Held as data rather than as nested layouts so the whole keyboard surface is one value
 * that the UI walks, which keeps adding a key a one-line change.
 */
fun keyRows(
    layout: KeyLayout,
    shift: Boolean,
): List<List<KeySpec>> =
    when (layout) {
        KeyLayout.LETTERS ->
            listOf(
                lettersOf("qwertyuiop", shift),
                lettersOf("asdfghjkl", shift),
                listOf(KeySpec(KeyAction.Shift, "⇧", KeyStyle.SPECIAL, 1.5f)) +
                    lettersOf("zxcvbnm", shift) +
                    listOf(KeySpec(KeyAction.Backspace, "⌫", KeyStyle.SPECIAL, 1.5f)),
                listOf(
                    // Two hops, because the number layer is in the way of the symbol layer.
                    KeySpec(KeyAction.SwitchTo(KeyLayout.NUMBERS), "?123", KeyStyle.SPECIAL),
                    KeySpec(KeyAction.Symbol(","), ","),
                    KeySpec(KeyAction.Space, "space", KeyStyle.NORMAL, 4f),
                    KeySpec(KeyAction.Symbol("."), "."),
                    KeySpec(KeyAction.Enter, "↵", KeyStyle.ACCENT),
                ),
            )

        KeyLayout.NUMBERS ->
            listOf(
                digitsOf("1234567890"),
                symbolsOf("@#\$%&*-+()"),
                listOf(
                    KeySpec(KeyAction.SwitchTo(KeyLayout.LETTERS), "ABC", KeyStyle.SPECIAL, 1.5f),
                    KeySpec(KeyAction.Symbol("!"), "!"),
                    KeySpec(KeyAction.Symbol("?"), "?"),
                    KeySpec(KeyAction.Symbol("'"), "'"),
                    KeySpec(KeyAction.Symbol("\""), "\""),
                    KeySpec(KeyAction.Backspace, "⌫", KeyStyle.SPECIAL, 1.5f),
                ),
                listOf(
                    KeySpec(KeyAction.SwitchTo(KeyLayout.SYMBOLS), "?#+=", KeyStyle.SPECIAL),
                    KeySpec(KeyAction.Symbol(","), ","),
                    KeySpec(KeyAction.Space, "space", KeyStyle.NORMAL, 4f),
                    KeySpec(KeyAction.Symbol("."), "."),
                    KeySpec(KeyAction.Enter, "↵", KeyStyle.ACCENT),
                ),
            )

        KeyLayout.SYMBOLS ->
            listOf(
                symbolsOf("~`|\\^;:"),
                symbolsOf("_+=<>€£¥·"),
                listOf(
                    KeySpec(KeyAction.SwitchTo(KeyLayout.NUMBERS), "123", KeyStyle.SPECIAL, 1.5f),
                    KeySpec(KeyAction.Symbol("("), "("),
                    KeySpec(KeyAction.Symbol(")"), ")"),
                    KeySpec(KeyAction.Symbol("["), "["),
                    KeySpec(KeyAction.Symbol("]"), "]"),
                    KeySpec(KeyAction.Backspace, "⌫", KeyStyle.SPECIAL, 1.5f),
                ),
                listOf(
                    KeySpec(KeyAction.SwitchTo(KeyLayout.LETTERS), "ABC", KeyStyle.SPECIAL),
                    KeySpec(KeyAction.Symbol(","), ","),
                    KeySpec(KeyAction.Space, "space", KeyStyle.NORMAL, 4f),
                    KeySpec(KeyAction.Symbol("."), "."),
                    KeySpec(KeyAction.Enter, "↵", KeyStyle.ACCENT),
                ),
            )
    }

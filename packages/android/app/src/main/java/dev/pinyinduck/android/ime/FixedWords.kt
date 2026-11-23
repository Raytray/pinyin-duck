package dev.pinyinduck.android.ime

import dev.pinyinduck.android.engine.FixedWord
import dev.pinyinduck.android.engine.Span
import dev.pinyinduck.android.engine.cleanPinyin

/*
 * The keyboard's side of Fixed words (#37): the engine is stateless, so the session holds the
 * list and these decide what is left of it, and of the composition, as things change. Ports of
 * the web's `packages/web/src/sentence/fixed-words.ts`, so both platforms behave the same.
 */

/**
 * The raw composing text left after committing a Sentence candidate through a word that ends
 * at [tonelessEnd], an offset in the toneless query (`cleanPinyin(raw)`, which is what a word's
 * span counts in). The raw text still holds tone digits and separators, so the offset is mapped
 * back to it here. Any of those right after the word go with the commit: a tone digit belongs
 * to the word's last syllable, and a separator has nothing left to separate.
 */
internal fun composingAfter(
    raw: String,
    tonelessEnd: Int,
): String {
    var cut = 0
    while (cut < raw.length && cleanPinyin(raw.substring(0, cut)).length < tonelessEnd) cut++
    while (cut < raw.length && cleanPinyin(raw.substring(0, cut + 1)).length == tonelessEnd) cut++
    return raw.substring(cut)
}

/**
 * The Fixed words that last once the composition has changed to [raw]: they hold while the
 * learner types on, and one goes as soon as a Backspace reaches into its span. Commits and
 * cancelling clear them all, which is the caller's job.
 *
 * A fixed completed last word (咖啡 fixed on `ka`, its key `kafei` running past the span) is
 * held by the engine only while its span ends the query. So while the learner goes on typing
 * its key, its span stretches to the end of the query; once the query covers the whole key the
 * span becomes exactly the key, an ordinary fixed word from then on. If the typing leaves the
 * key (`kan`), the word is dropped: the learner is typing something else.
 */
internal fun carryFixedWords(
    fixed: List<FixedWord>,
    raw: String,
): List<FixedWord> {
    val toneless = cleanPinyin(raw)
    return fixed.mapNotNull { word ->
        val (start, end) = word.span
        val key = cleanPinyin(word.pinyinNumbers)
        val typed = if (end <= toneless.length) toneless.substring(start) else ""
        when {
            end > toneless.length -> null
            key.length <= end - start -> word
            typed.startsWith(key) -> word.copy(span = Span(start, start + key.length))
            key.startsWith(typed) -> word.copy(span = Span(start, toneless.length))
            else -> null
        }
    }
}

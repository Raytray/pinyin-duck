import { cleanPinyin, type FixedWord } from '@pinyinduck/core';

/**
 * The raw composing text left after committing a Sentence candidate through a word that ends
 * at `tonelessEnd`, an offset in the toneless query (`cleanPinyin(raw)`, which is what a
 * word's `span` counts in). The raw text still holds tone digits and separators, so the
 * offset is mapped back to it here. Any of those right after the word go with the commit: a
 * tone digit belongs to the word's last syllable, and a separator has nothing left to separate.
 */
export function composingAfter(raw: string, tonelessEnd: number): string {
  let cut = 0;
  while (cut < raw.length && cleanPinyin(raw.slice(0, cut)).length < tonelessEnd) cut++;
  while (cut < raw.length && cleanPinyin(raw.slice(0, cut + 1)).length === tonelessEnd) cut++;
  return raw.slice(cut);
}

/**
 * The Fixed words that last once the composition has changed to `raw` (#37): they hold while
 * the learner types on, and one goes as soon as a Backspace reaches into its span. Commits
 * and Esc clear them all, which is the caller's job.
 *
 * A fixed completed last word (咖啡 fixed on `ka`, its key `kafei` running past the span) is
 * held by the engine only while its span ends the query. So while the learner goes on typing
 * its key, its span stretches to the end of the query; once the query covers the whole key the
 * span becomes exactly the key, an ordinary fixed word from then on. If the typing leaves the
 * key (`kan`), the word is dropped: the learner is typing something else.
 */
export function carryFixedWords(fixed: readonly FixedWord[], raw: string): FixedWord[] {
  const toneless = cleanPinyin(raw);
  const carried: FixedWord[] = [];
  for (const word of fixed) {
    if (word.end > toneless.length) continue;
    const key = cleanPinyin(word.word.pinyinNumbers);
    if (key.length <= word.end - word.start) {
      carried.push(word);
      continue;
    }
    const typed = toneless.slice(word.start);
    if (typed.startsWith(key)) carried.push({ ...word, end: word.start + key.length });
    else if (key.startsWith(typed)) carried.push({ ...word, end: toneless.length });
  }
  return carried;
}

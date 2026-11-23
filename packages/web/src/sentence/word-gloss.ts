/** Senses in a short gloss are joined with this (see `formatGloss` in core). */
const SENSE_SEPARATOR = ' / ';

/**
 * The gloss drawn under one word of a Sentence candidate: the first sense of its short
 * gloss, with any leading parenthetical ("(of a person)") dropped, so it fits under the word.
 * A sense that is nothing but a parenthetical is kept whole rather than left empty.
 */
export function wordGloss(shortGloss: string): string {
  const first = shortGloss.split(SENSE_SEPARATOR)[0].trim();
  return first.replace(/^\([^)]*\)\s*/, '') || first;
}

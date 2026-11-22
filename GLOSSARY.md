# PinyinDuck

A Mandarin input method for language learners: typing pinyin shows tone-marked candidates
with concise English definitions.

## Language

### Dictionary

**Headword**:
A word as written, identified by its traditional and simplified forms together. 後 and 后 are
different headwords even though both simplify to 后.
_Avoid_: Word, character (when the pair is meant)

**Reading**:
The pinyin a headword is pronounced with, ignoring capitalisation. Shū and shū are one reading.
_Avoid_: Pronunciation, romanisation

**Entry**:
One headword with one reading, holding everything the dictionary says about that pairing.
_Avoid_: Line, row, record

**Sense**:
One meaning of an entry, as an English definition.
_Avoid_: Definition (for a single meaning), gloss

**Tag**:
A labelled fact about an entry pulled out of its senses, such as being a surname, a variant of
another headword, an abbreviation, or having an alternative written form or reading.
_Avoid_: Label, note, flag

**Measure word**:
A word used to count or quantify a noun, listed for the entries that take one.
_Avoid_: Classifier

**Proper noun sense**:
A sense that names a specific person, place, work or family (including a surname) rather than
a common meaning.
_Avoid_: Name reading

**Part of speech**:
The grammatical category of an entry, such as noun or verb, from a fixed set of learner labels.
An entry may have several, or none.
_Avoid_: Word class, POS tag

### Input

**Candidate**:
One choice offered for a pinyin query: Hanzi in the active script, a reading, and a short gloss.
In simplified script one candidate can stand for several headwords that share a simplified form.
_Avoid_: Suggestion, result

**Sentence candidate**:
A candidate made of several dictionary words, one after another, covering the query from its
start as far as they can be built with confidence; any pinyin left over stays to compose next.
Each word keeps its own reading and gloss, so the learner can see how it was built. Still a
sentence candidate when it is only a two-word phrase; a single word that stops short of the
end is a prefix word, not a sentence candidate.
_Avoid_: Phrase candidate, composed candidate, prediction

**Fixed word**:
A word the learner has chosen in place of another inside a sentence candidate, covering the
same pinyin. The rest of the sentence is rebuilt around it, and it stays chosen while the
learner keeps composing.
_Avoid_: Pinned word, locked word, override

**Expanded candidate list**:
The full list of candidates for the current query, each with its reading and short gloss,
opened from the keyboard in place of the paged candidate strip.
_Avoid_: Expanded view, all candidates, grid

**Candidate detail**:
The view of one candidate that shows everything known about that word and reading beyond
the short gloss, opened by Tab or ⓘ on web, or by long-press on Android. Never called
"expanded", which means the **Expanded candidate list**.
_Avoid_: Entry card, definition sheet, popup, expanded candidate

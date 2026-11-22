# Dictionary source data

## CC-CEDICT

`cedict_1_0_ts_utf-8_mdbg.txt` is CC-CEDICT, edition `2026-11-06T08:10:12Z` (125,369
entries). It is the file MDBG published at
<https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz>, unzipped and
otherwise unchanged, CRLF line endings included.

It is committed because MDBG only serves the latest edition, so there is no URL to pin.
The dictionary build reads it from here and checks it against the SHA-256 in
`../scripts/sources.ts`, which also gives the steps for moving to a new edition. Edit it
only by replacing it with a newer edition: any other change, even a line ending, fails
the build.

### License

CC-CEDICT is published by MDBG under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/);
the file's own header has the full notice and credits. The dictionary assets built from
it are adaptations under the same license. [DATA_LICENSES.md](../../../DATA_LICENSES.md)
credits every source and lists the files that license covers.

## English Wiktionary part of speech

`wiktionary-pos.tsv` holds the part-of-speech rows of every Chinese entry in the English
Wiktionary with a Standard Mandarin reading: traditional, simplified, tone-marked reading and
wiktextract's part-of-speech name. `../scripts/reduce-wiktionary.ts` wrote it from kaikki.org's
raw wiktextract dump, and its header names that dump's date, URL and SHA-256. It is committed
because kaikki.org only serves its latest dump, which is about 3 GB. Regenerate it with that
script rather than editing it; `../scripts/sources.ts` pins its SHA-256 too.

It is English Wiktionary contributors' work under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), reduced to these four columns.

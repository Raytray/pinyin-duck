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

## HSK 3.0 levels

`hsk3-levels.tsv` holds the HSK 3.0 vocabulary as word, reading and level: the reading exactly
as the syllabus prints it, tone sandhi included, and the level 1-6, or 7 for the 7-9 band.
`../scripts/extract-hsk3.py` wrote it from the official syllabus, 《中文水平考试 HSK 考试大纲》
(中外语言交流合作中心, 2025-11), and its header names that PDF's URL and SHA-256. It is
committed because the build should not depend on a PDF download, and the PDF itself is not:
nothing else from it is kept. Regenerate it with that script, run by hand, rather than editing
it; `../scripts/sources.ts` pins its SHA-256 too.

The syllabus has no license. The levels are included as facts;
[DATA_LICENSES.md](../../../DATA_LICENSES.md) says why, and gives the full citation.

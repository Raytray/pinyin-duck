# Dictionary source data

`cedict_1_0_ts_utf-8_mdbg.txt` is CC-CEDICT, edition `2026-11-06T08:10:12Z` (125,369
entries). It is the file MDBG published at
<https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz>, unzipped and
otherwise unchanged, CRLF line endings included.

It is committed because MDBG only serves the latest edition, so there is no URL to pin.
The dictionary build reads it from here and checks it against the SHA-256 in
`../scripts/sources.ts`, which also gives the steps for moving to a new edition. Edit it
only by replacing it with a newer edition: any other change, even a line ending, fails
the build.

## License

CC-CEDICT is published by MDBG under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/);
the file's own header has the full notice and credits. The dictionary assets built from
it are adaptations under the same license. What that requires before the repository or
the apps are distributed publicly is tracked in #24.

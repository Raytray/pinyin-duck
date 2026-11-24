# Data licenses

PinyinDuck's code is under the MIT License (see [LICENSE](LICENSE)). The dictionary it
types from is built from six third-party sources, which have their own licenses. This
file credits them and says what license the built dictionary files are under.

## Sources

| Source | Author | License | Used for |
|---|---|---|---|
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | MDBG and the CC-CEDICT contributors, based on CEDICT by Paul Andrew Denisowski | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Words, readings and English definitions |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords), `content/2018/zh_cn/zh_cn_50k.txt` | Hermit Dave, from the [OpenSubtitles 2018](https://opus.nlpl.eu/OpenSubtitles2018.php) corpus | Content under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (the repository's code is MIT) | Candidate ranking |
| [OpenSubtitles 2018](https://opus.nlpl.eu/OpenSubtitles/v2018/OpenSubtitles), monolingual `zh_cn.txt.gz` | Compiled by [OPUS](https://opus.nlpl.eu/) from subtitles at [opensubtitles.org](https://www.opensubtitles.org/) (P. Lison and J. Tiedemann, "OpenSubtitles2016: Extracting Large Parallel Corpora from Movie and TV Subtitles", LREC 2016) | No license stated; OPUS asks that opensubtitles.org be credited. The same text the FrequencyWords list is counted from | Word-pair (bigram) counts for ranking Sentence candidates |
| [HSK 3.0 syllabus (2025)](https://www.chinesetest.cn/), 《中文水平考试 HSK 考试大纲》, 2025-11 | Center for Language Education and Cooperation (中外语言交流合作中心), distributed by Chinese Testing International | No licence; the levels are included as facts (see [HSK levels](#hsk-levels)) | HSK 3.0 levels shown on candidates |
| [English Wiktionary](https://en.wiktionary.org/), enwiktionary dump of 2026-10-01 as extracted by [wiktextract](https://github.com/tatuylonen/wiktextract) (Tatu Ylonen) and published by [kaikki.org](https://kaikki.org/dictionary/rawdata.html) on 2026-10-30 | English Wiktionary contributors | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Part of speech in the Candidate detail |
| [HanDeDict](https://github.com/gugray/HanDeDict), `handedict.u8` at commit `0760a107` (export of 2026-11-21) | HanDeDict contributors; published by Gábor L Ugray, originally created with the Chinesisch-Deutsche Gesellschaft e.V. Hamburg ([handedict.zydeo.net](https://handedict.zydeo.net/)) | [CC BY-SA 2.0 DE](https://creativecommons.org/licenses/by-sa/2.0/de/) / [3.0](https://creativecommons.org/licenses/by-sa/3.0/) (the repository and the file header disagree on the version), adapted under CC BY-SA 4.0 | Part of speech in the Candidate detail, for entries Wiktionary does not tag |

The exact editions are pinned in
[`packages/core/scripts/sources.ts`](packages/core/scripts/sources.ts). The CC-CEDICT
edition is committed unchanged in [`packages/core/data/`](packages/core/data/), and its
header carries MDBG's full notice.

The Wiktionary rows are committed in reduced form as
[`packages/core/data/wiktionary-pos.tsv`](packages/core/data/wiktionary-pos.tsv), whose header
names the dump and its SHA-256. Per-entry attribution for Wiktionary is the page
`https://en.wiktionary.org/wiki/<headword>`. Both licenses on the part-of-speech sources allow
an adaptation to be licensed under a later version of CC BY-SA, which is how they come under
the 4.0 license of the built files below.

The bigram table is counted from the OpenSubtitles text the FrequencyWords list already comes
from, so it adds no new license question: like that list, it holds only counts derived from
the text, published here under CC BY-SA 4.0 with credit to OPUS and opensubtitles.org.

### HSK levels

The HSK levels come from the HSK 3.0 syllabus, which carries no licence. Only which level
each word at a reading belongs to is taken, and it is included as facts: a word's place in an
official standard is not an original expression (Copyright Law of the PRC, Art. 3), so the
project holds no rights in it, and CC BY-SA 4.0 reaches the levels only as far as they are
copyrightable at all. The built files stay under CC BY-SA 4.0. The residual risk is that the
whole graded list could be claimed as a compilation (Art. 15). If that claim were made, the
fallback is to ship the levels as a separate file outside the CC BY-SA files.

The levels were extracted from the syllabus PDF by
[`packages/core/scripts/extract-hsk3.py`](packages/core/scripts/extract-hsk3.py), although the
PDF sets a permission flag against copying and extracting its content. Only the word, the
reading as printed and the level are committed, as
[`packages/core/data/hsk3-levels.tsv`](packages/core/data/hsk3-levels.tsv); the PDF, its parts of
speech, row numbers and layout are not.

No licence or reuse terms for the level data were found, and nothing found restricts
commercial use. This is not legal advice.

Full citation: 《中文水平考试 HSK 考试大纲》, 中外语言交流合作中心 (Center for Language
Education and Cooperation), 2025-11, distributed by Chinese Testing International,
<https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf>, SHA-256 `d8b6646599bc9a0c9616a4cb06d4b37461f8792f70a3171016d00fcd8eda09ad`.
Source: www.chinesetest.cn

## Built dictionary files

These files are built from the sources above, so they are adaptations of CC-CEDICT and
FrequencyWords, the Candidate detail file also of English Wiktionary and HanDeDict, and the
bigram table also of OpenSubtitles 2018 as compiled by OPUS. They are licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and anyone who receives
them may reuse them on those terms:

- `dictionary.btree`, bundled in the Android APK, and its gzip copy `dictionary.btree.gz`,
  which the web app downloads
- the Rime dictionaries `pinyinduck.dict.yaml` and `pinyinduck_trad.dict.yaml`
- the Rime gloss data `lua/pinyinduck_gloss.lua`
- the Candidate detail file `detail.bin` and its gzip copy `detail.bin.gz`, which hold every
  sense, tag, measure word and part of speech of each entry
- the bigram table `bigrams.bin` and its gzip copy `bigrams.bin.gz`, which hold a score for
  each pair of words seen next to each other at least five times in the OpenSubtitles text
- `packages/core/data/wiktionary-pos.tsv`, the reduced Wiktionary rows
- `packages/android/app/src/test/resources/engine-parity.tsv` and `detail-parity.tsv`, the
  parity test goldens

**Changes made to the sources:** the build joins CC-CEDICT and the frequency list on the
simplified form, attaches each HSK level to the CC-CEDICT entries for its word at its
reading (dropping the few rows no entry matches), skips CC-CEDICT lines it cannot parse,
keeps one entry per word and reading, ranks entries by
the frequency list (with surname readings lowered), shortens definitions to at most three
senses without classifier notes and cross-references for the short gloss, keeps every
sense for the Candidate detail with tags, measure words and cross-references parsed into
fields of their own, and stores the result in the formats above. From Wiktionary and HanDeDict
it takes **word-class tags only, mapped**: Wiktionary's part-of-speech headers and HanDeDict's
word-class abbreviations are joined to CC-CEDICT entries on headword and reading and mapped to
twelve learner labels (noun, verb, adjective, adverb, pronoun, numeral, measure word,
preposition, conjunction, particle, interjection, idiom). Proper-name tags and tags with no
clear label are dropped, and an entry takes its labels from Wiktionary when it gives any, else
from HanDeDict. No definitions, examples or other text are taken from either. From OpenSubtitles the
bigram table takes **pair counts only**: each line is split into CC-CEDICT words, adjacent
words are counted as pairs, pairs seen fewer than five times are dropped, and each kept pair
is stored as a score derived from its count. No subtitle text is stored.

The license on these files covers only the data. The code that builds and reads them is
MIT.

## Credit in the apps

People who use PinyinDuck never see this file, so each product also credits the sources:

- **Android:** the "Credits" section of the settings screen
- **Web:** the "Credits" button in the toolbar
- **Windows and macOS (Rime):** the header of each generated `.dict.yaml` and of
  `pinyinduck_gloss.lua`. The Rime files carry no Candidate detail, so Wiktionary and
  HanDeDict are not among their sources.

If you add a source, credit it in all of these places as well as here.

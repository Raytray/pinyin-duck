# Data licenses

PinyinDuck's code is under the MIT License (see [LICENSE](LICENSE)). The dictionary it
types from is built from three third-party sources, which have their own licenses. This
file credits them and says what license the built dictionary files are under.

## Sources

| Source | Author | License | Used for |
|---|---|---|---|
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | MDBG and the CC-CEDICT contributors, based on CEDICT by Paul Andrew Denisowski | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Words, readings and English definitions |
| [FrequencyWords](https://github.com/hermitdave/FrequencyWords), `content/2018/zh_cn/zh_cn_50k.txt` | Hermit Dave, from the [OpenSubtitles 2018](https://opus.nlpl.eu/OpenSubtitles2018.php) corpus | Content under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (the repository's code is MIT) | Candidate ranking |
| [hanyu-shuiping-kaoshi](https://github.com/gigacool/hanyu-shuiping-kaoshi), `hsk.csv` | gigacool | MIT, "Copyright (c) 2018 gigacool" | HSK 2012 levels shown on candidates |

The exact editions are pinned in
[`packages/core/scripts/sources.ts`](packages/core/scripts/sources.ts). The CC-CEDICT
edition is committed unchanged in [`packages/core/data/`](packages/core/data/), and its
header carries MDBG's full notice.

The HSK list's MIT license covers the gigacool compilation. The word list itself is the
HSK 2012 vocabulary published for the official exam.

## Built dictionary files

These files are built from the sources above, so they are adaptations of CC-CEDICT and
FrequencyWords. They are licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and anyone who receives
them may reuse them on those terms:

- `dictionary.btree` and `dictionary.json`, used by the web app and bundled in the Android APK
- the Rime dictionaries `pinyinduck.dict.yaml` and `pinyinduck_trad.dict.yaml`
- the Rime gloss data `lua/pinyinduck_gloss.lua`
- `packages/android/app/src/test/resources/engine-parity.tsv`, the parity test golden

**Changes made to the sources:** the build joins the three on the simplified form, skips
CC-CEDICT lines it cannot parse, keeps one entry per word and reading, ranks entries by
the frequency list (with surname readings lowered), shortens definitions to at most three
senses without classifier notes and cross-references, and stores the result in the
formats above.

The license on these files covers only the data. The code that builds and reads them is
MIT.

## Credit in the apps

People who use PinyinDuck never see this file, so each product also credits the sources:

- **Android:** the "Credits" section of the settings screen
- **Web:** the "Credits" button in the toolbar
- **Windows and macOS (Rime):** the header of each generated `.dict.yaml` and of
  `pinyinduck_gloss.lua`

If you add a source, credit it in all of these places as well as here.

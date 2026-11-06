/**
 * The exact inputs a dictionary build reads, pinned so two builds of the same commit
 * produce the same `dictionary.btree`.
 *
 * Each source has a URL that always serves the same bytes and the SHA-256 of its text
 * (after gunzip, so the hash also covers the copy in `.cache/`, which is stored
 * decompressed). The build checks both the cached copy and any fresh download against it,
 * and refuses to continue on a mismatch, so an upstream change can never alter the asset
 * without a commit here.
 *
 * - The two GitHub sources are pinned to a commit rather than `master`.
 * - CC-CEDICT has no versioned URL: mdbg.net only ever serves the latest edition. The
 *   pinned edition is therefore a copy, published as an asset on this repository's
 *   `cedict-<date>` GitHub release, byte-for-byte as mdbg served it on that date.
 *
 * Bumping a source is deliberate:
 *   1. CC-CEDICT: download the current edition from
 *      https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz and
 *      attach it unchanged to a new `cedict-<date>` release. For a GitHub source, pick the
 *      new commit.
 *   2. Update `url` and `sha256` below (`gunzip -c <file> | sha256sum` for CC-CEDICT).
 *   3. `npm run build:dict -w @pinyinduck/core -- --no-cache`, then `npm run build:parity`
 *      and commit the regenerated `engine-parity.tsv` with this file. CI tests against
 *      the committed golden and no longer regenerates it, so the two travel together.
 */

export interface PinnedSource {
  /** A URL that serves the same bytes on every request. */
  url: string;
  /** The file under `packages/core/.cache/` holding the decompressed text. */
  cacheName: string;
  /** Whether the download is gzip and has to be decompressed before use. */
  gzip: boolean;
  /** SHA-256 of the decompressed text, lowercase hex. */
  sha256: string;
}

export const SOURCES = {
  cedict: {
    // CC-CEDICT edition dated 2026-11-06T08:10:12Z, 125369 entries.
    url: 'https://github.com/Raytray/pinyin-duck/releases/download/cedict-2026-11-06/cedict_1_0_ts_utf-8_mdbg.txt.gz',
    cacheName: 'cedict.txt',
    gzip: true,
    sha256: 'ff107587bc1d593dd5d7a49c179d4aa749cb89b3a1423876e0cd2dca197b672b',
  },
  frequency: {
    // hermitdave/FrequencyWords, OpenSubtitles 2018, zh_cn top 50k.
    url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/zh_cn/zh_cn_50k.txt',
    cacheName: 'zh_cn_50k.txt',
    gzip: false,
    sha256: '25599e00347b893e55c3058a748819b3fe19403291cd12f7c03af128e7f3fe45',
  },
  hsk: {
    // gigacool/hanyu-shuiping-kaoshi, the HSK 2012 word list.
    url: 'https://raw.githubusercontent.com/gigacool/hanyu-shuiping-kaoshi/5875a36415856c456cbc8364fba5306a415a9ebc/hsk.csv',
    cacheName: 'hsk.csv',
    gzip: false,
    sha256: 'f45235585b14878e93be2eb66cdb1fe635136c3df7fdc311fdcc7e591b0c4f11',
  },
} as const satisfies Record<string, PinnedSource>;

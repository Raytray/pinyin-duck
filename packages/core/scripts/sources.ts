/**
 * The exact inputs a dictionary build reads, pinned so two builds of the same commit
 * produce the same `dictionary.btree`.
 *
 * Each source carries the SHA-256 of its text. The build checks every read against it,
 * whether from the repository, the download cache or a fresh download, and refuses to
 * continue on a mismatch, so an upstream change can never alter the asset without a
 * commit here.
 *
 * - CC-CEDICT is committed: mdbg.net only ever serves the latest edition, so there is no
 *   URL to pin. `packages/core/data/` holds the edition unzipped and byte-for-byte as
 *   MDBG published it; its README says where it came from and under what license.
 * - The two GitHub sources are downloaded from a commit rather than `master`, and cached
 *   in `packages/core/.cache/`.
 *
 * Bumping a source is deliberate:
 *   1. CC-CEDICT: `curl -sL https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
 *      | gunzip > packages/core/data/cedict_1_0_ts_utf-8_mdbg.txt`, leaving the file
 *      otherwise untouched. For a GitHub source, pick the new commit and update `url`.
 *   2. Update `sha256` below (`sha256sum <file>`) and the edition comment.
 *   3. `npm run build:dict -w @pinyinduck/core -- --no-cache`, then `npm run build:parity`
 *      and commit the regenerated `engine-parity.tsv` with this file. CI tests against
 *      the committed golden and no longer regenerates it, so the two travel together.
 */

/** A source read from a file committed to this repository. */
export interface VendoredSource {
  /** The file's path relative to `packages/core/`. */
  file: string;
  /** SHA-256 of the file, lowercase hex. */
  sha256: string;
}

/** A source downloaded from a URL that serves the same bytes on every request. */
export interface DownloadedSource {
  url: string;
  /** The file under `packages/core/.cache/` holding the downloaded text. */
  cacheName: string;
  /** SHA-256 of the downloaded text, lowercase hex. */
  sha256: string;
}

export type PinnedSource = VendoredSource | DownloadedSource;

export const SOURCES = {
  cedict: {
    // CC-CEDICT edition dated 2026-11-06T08:10:12Z, 125369 entries.
    file: 'data/cedict_1_0_ts_utf-8_mdbg.txt',
    sha256: 'ff107587bc1d593dd5d7a49c179d4aa749cb89b3a1423876e0cd2dca197b672b',
  },
  frequency: {
    // hermitdave/FrequencyWords, OpenSubtitles 2018, zh_cn top 50k.
    url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/content/2018/zh_cn/zh_cn_50k.txt',
    cacheName: 'zh_cn_50k.txt',
    sha256: '25599e00347b893e55c3058a748819b3fe19403291cd12f7c03af128e7f3fe45',
  },
  hsk: {
    // gigacool/hanyu-shuiping-kaoshi, the HSK 2012 word list.
    url: 'https://raw.githubusercontent.com/gigacool/hanyu-shuiping-kaoshi/5875a36415856c456cbc8364fba5306a415a9ebc/hsk.csv',
    cacheName: 'hsk.csv',
    sha256: 'f45235585b14878e93be2eb66cdb1fe635136c3df7fdc311fdcc7e591b0c4f11',
  },
} as const satisfies Record<string, PinnedSource>;

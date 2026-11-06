#!/usr/bin/env node
/**
 * Fails, in words, when a generated dictionary asset is not on disk.
 *
 * The assets are produced by `npm run build:dict` and `npm run build:rime` and are not
 * committed — together they are 27MB of data derived from three pinned sources, and a
 * commit carrying one is a diff nobody reads. A fresh clone therefore has to build them.
 *
 * The commands that need them fail in two unhelpful ways when they are absent. The dev
 * server starts and the app sits on "failed to load" with nothing in the terminal. And
 * Playwright spends its per-test timeout on `gotoApp` waiting for a status that never
 * arrives, then reports 40 failures that all say the same thing about a file nobody
 * mentioned. So this runs first and names the file, with the command that builds it.
 *
 * Plain Node and no build step, because it has to work on a fresh clone where nothing has
 * been compiled yet — which is also why it is at the repository root and not in a
 * workspace.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * What has to be on disk, and what to tell the reader about it.
 *
 * `paths` are resolved against `dir`, and the entries that are absent are listed
 * individually rather than as a directory, so the message names the file that is missing
 * rather than the folder that contains it.
 */
const ASSETS = [
  {
    dir: join(ROOT, 'packages', 'web', 'public'),
    paths: ['dictionary.btree'],
    label: 'the web dictionary',
    build: 'npm run build:dict',
    why: 'the app fetches it page by page at runtime, and every e2e test waits for it',
  },
  {
    dir: join(ROOT, 'packages', 'windows', 'rime'),
    paths: ['pinyinduck.dict.yaml', 'pinyinduck_trad.dict.yaml'],
    label: 'the Rime dictionaries',
    build: 'npm run build:rime',
    why: 'the Windows schema reads them, and the Rime verification types into them',
  },
];

const missing = ASSETS.map((asset) => ({
  ...asset,
  absent: asset.paths.filter((name) => !existsSync(join(asset.dir, name))),
})).filter((asset) => asset.absent.length > 0);

if (missing.length === 0) process.exit(0);

const lines = ['', 'The generated dictionary assets are not built.', ''];
for (const asset of missing) {
  for (const name of asset.absent) {
    lines.push(`  ${relative(ROOT, join(asset.dir, name))} — ${asset.label}`);
  }
  lines.push(`    because ${asset.why}`);
  lines.push('');
}
lines.push('Build them with:');
for (const asset of missing) {
  lines.push(`  ${asset.build.padEnd(20)} # ${asset.label}`);
}
lines.push('');
lines.push('None of these are committed: each is ~9MB of data derived from three pinned');
lines.push('sources, so a commit carrying one is a 9MB diff that changes whenever a source');
lines.push('is bumped. CC-CEDICT is in the repo and the other two downloads are cached in');
lines.push('packages/core/.cache/, so this is a one-time cost per clone.');
lines.push('');
lines.push('Or run `npm run build`, which does both and then builds every workspace.');
lines.push('');

process.stderr.write(lines.join('\n'));
process.exit(1);

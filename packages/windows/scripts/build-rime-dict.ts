/**
 * Generates the Rime dictionary files the Windows input method loads.
 *
 * Reads the paged B+ tree the rest of the project shares and writes one
 * `<name>.dict.yaml` per script into `packages/windows/rime`, next to the hand-written
 * schemas that reference them. Nothing is materialized: the tree is walked in key order
 * and each code is emitted as soon as the walk leaves it, so peak memory is the largest
 * group of same-reading entries rather than the corpus.
 *
 * Usage:
 *   npm run build:rime                        # dictionary.btree -> rime/*.dict.yaml
 *   npm run build:rime -- --out <dir>         # write the dictionaries somewhere else
 *   npm run build:rime -- --btree <path>      # read a different asset
 */

import * as fs from 'fs';
import * as path from 'path';
import { BTreeDictionary } from '../../core/src/data/btree-dictionary.js';
import { MemoryPageSource } from '../../core/src/data/page-source.js';
import {
  RIME_SCRIPTS,
  RimeDictWriter,
  formatRow,
  renderDictHeader,
  type RimeScript,
} from '../src/rime-dict.js';

const DEFAULT_BTREE = path.resolve(__dirname, '../../web/public/dictionary.btree');
const DEFAULT_OUT_DIR = path.resolve(__dirname, '../rime');

/**
 * Dictionary names.
 *
 * A dictionary file is only compiled for the schema that names it in
 * `translator/dictionary`, so these have to stay in step with `rime/*.schema.yaml`.
 */
export const DICT_NAMES: Record<RimeScript, string> = {
  simplified: 'pinyinduck',
  traditional: 'pinyinduck_trad',
};

/** Bumped when the emitted layout changes, so Weasel recompiles on update. */
export const DICT_VERSION = '0.1.0';

/** Rows buffered before a write, to keep 122k rows from becoming 122k syscalls. */
const FLUSH_INTERVAL = 4096;

/** One output file. */
export interface RimeFileSink {
  write(chunk: string): void;
  close(): void;
}

/**
 * Everything the build touches outside the dictionary itself.
 *
 * Injected rather than mocked so the streaming and file-writing paths can be tested
 * without a real 9MB asset, which is the only part of this script that is not a thin
 * translation of `RimeDictWriter`.
 */
export interface RimeBuildDeps {
  exists(path: string): boolean;
  readAsset(path: string): Uint8Array;
  ensureDir(path: string): void;
  openFile(path: string): RimeFileSink;
}

const nodeDeps: RimeBuildDeps = {
  exists: (p) => fs.existsSync(p),
  readAsset: (p) => new Uint8Array(fs.readFileSync(p)),
  ensureDir: (p) => fs.mkdirSync(p, { recursive: true }),
  openFile: (p) => {
    const fd = fs.openSync(p, 'w');
    let buffered: string[] = [];
    return {
      write(chunk) {
        buffered.push(chunk);
        if (buffered.length >= FLUSH_INTERVAL) {
          fs.writeSync(fd, buffered.join('\n') + '\n');
          buffered = [];
        }
      },
      close() {
        if (buffered.length > 0) fs.writeSync(fd, buffered.join('\n') + '\n');
        fs.closeSync(fd);
      },
    };
  },
};

/** Per-script outcome, reported so a truncated build is visible rather than silent. */
export interface RimeScriptStats {
  rows: number;
  skipped: number;
  unencodable: number;
  duplicates: number;
}

export interface RimeBuildStats {
  entryCount: number;
  files: Record<RimeScript, string>;
  scripts: Record<RimeScript, RimeScriptStats>;
}

export interface RimeBuildOptions {
  btreePath: string;
  outDir: string;
}

/**
 * Walks the asset once and writes every dictionary from it.
 *
 * A single pass feeds both scripts: the traditional rows are derived from the same
 * entry, and a second pass would re-read 9MB of pages for no new information.
 */
export async function buildRimeDictionaries(
  options: RimeBuildOptions,
  deps: RimeBuildDeps = nodeDeps
): Promise<RimeBuildStats> {
  if (!deps.exists(options.btreePath)) {
    throw new Error(
      `The dictionary asset is missing: ${options.btreePath}\n` +
        'Run "npm run build:dict" to generate it before "npm run build:rime".'
    );
  }

  const dictionary = await BTreeDictionary.open(
    new MemoryPageSource(deps.readAsset(options.btreePath))
  );

  deps.ensureDir(options.outDir);

  const entryCount = dictionary.entryCount;
  const files = {} as Record<RimeScript, string>;
  const writers = {} as Record<RimeScript, RimeDictWriter>;
  const sinks = {} as Record<RimeScript, RimeFileSink>;

  for (const script of RIME_SCRIPTS) {
    const name = DICT_NAMES[script];
    const filePath = path.join(options.outDir, `${name}.dict.yaml`);
    const sink = deps.openFile(filePath);
    sink.write(
      renderDictHeader({
        name,
        version: DICT_VERSION,
        entryCount,
      })
    );
    writers[script] = new RimeDictWriter(
      { name, version: DICT_VERSION, entryCount },
      script,
      (row) => sink.write(formatRow(row))
    );
    files[script] = filePath;
    sinks[script] = sink;
  }

  await dictionary.scanPrefix('', (entry) => {
    for (const script of RIME_SCRIPTS) writers[script].add(entry);
    return true;
  });

  for (const script of RIME_SCRIPTS) {
    writers[script].finish();
    sinks[script].close();
  }

  const scripts = {} as Record<RimeScript, RimeScriptStats>;
  for (const script of RIME_SCRIPTS) {
    scripts[script] = {
      rows: writers[script].rowCount,
      skipped: writers[script].skippedCount,
      unencodable: writers[script].unencodableCount,
      duplicates: writers[script].duplicateCount,
    };
  }

  return { entryCount, files, scripts };
}

/**
 * Resolves the CLI flags into build options.
 *
 * Split out from `main` so the flag handling can be tested without running a build.
 */
export function parseArgs(args: string[]): RimeBuildOptions {
  const outIndex = args.indexOf('--out');
  const btreeIndex = args.indexOf('--btree');
  return {
    outDir: outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : DEFAULT_OUT_DIR,
    btreePath:
      btreeIndex >= 0 && args[btreeIndex + 1] ? args[btreeIndex + 1] : DEFAULT_BTREE,
  };
}

/** Builds and reports, so the CLI is a thin wrapper that tests can drive directly. */
export async function main(args: string[], deps: RimeBuildDeps = nodeDeps): Promise<void> {
  const { btreePath, outDir } = parseArgs(args);
  const started = Date.now();
  console.log('Building the PinyinDuck Rime dictionaries from the B+ tree asset...\n');

  const stats = await buildRimeDictionaries({ btreePath, outDir }, deps);

  console.log(`  source  ${btreePath} (${stats.entryCount} entries)`);
  for (const script of RIME_SCRIPTS) {
    const { rows, skipped, unencodable, duplicates } = stats.scripts[script];
    console.log(
      `  wrote   ${stats.files[script]} ` +
        `(${rows} rows, ${duplicates} duplicates dropped, ` +
        `${unencodable} unreadable readings, ${skipped} missing text)`
    );
  }
  console.log('\nNext: run scripts/install.ps1 to copy these into %APPDATA%\\Rime.');
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

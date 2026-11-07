#!/usr/bin/env node
/**
 * Runs a platform's real Rime installer against a temporary user folder and checks what it
 * wrote.
 *
 *   node scripts/check-rime-install.mjs windows   # install.ps1, on Windows
 *   node scripts/check-rime-install.mjs macos     # install.sh, on macOS
 *   node scripts/check-rime-install.mjs wsl       # install-from-wsl.sh, on Linux
 *
 * The unit tests cover the default.custom.yaml merge, and `npm run test:rime` proves librime
 * accepts the files, but neither runs install.ps1 or install.sh. Those are only ever
 * executed on their own OS, so a path, a quoting rule or a BSD-vs-GNU flag can break them
 * without anything on Linux noticing. This is that missing run, in CI, on the real OS.
 *
 * The installer is pointed at a scratch folder by overriding the variable it derives the
 * Rime folder from: APPDATA on Windows, HOME on macOS, and PINYINDUCK_RIME_DIR for the WSL
 * installer, which otherwise asks Windows for APPDATA through powershell.exe. Nothing is
 * installed for real, and Weasel or Squirrel need not be present: this checks the files,
 * not a deploy.
 *
 * Three runs, each checking one promise the installer makes:
 *   1. a fresh install copies every file byte for byte and creates default.custom.yaml;
 *   2. running it again changes nothing and makes no backup;
 *   3. over a user's own default.custom.yaml it backs that up, keeps the user's entries,
 *      adds PinyinDuck's, and clears a stale build/ folder.
 *
 * Needs `npm run build:dict && npm run build:rime` (or their output) first.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What each installer copies, as paths relative to the platform's rime/ folder. */
const COPIED = [
  'pinyinduck.schema.yaml',
  'pinyinduck_trad.schema.yaml',
  'pinyinduck.dict.yaml',
  'pinyinduck_trad.dict.yaml',
  'lua/pinyinduck_gloss_filter.lua',
  'lua/pinyinduck_gloss.lua',
];

/**
 * `source` is the packages/<source>/rime folder an installer copies from: the WSL
 * installer installs the Windows files, from the Linux side.
 */
const PLATFORMS = {
  windows: {
    source: 'windows',
    command: 'powershell',
    args: [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(REPO_ROOT, 'packages', 'windows', 'scripts', 'install.ps1'),
    ],
    /** The installer writes to `$env:APPDATA\Rime`. */
    env: (scratch) => ({ APPDATA: scratch }),
    rimeDir: (scratch) => path.join(scratch, 'Rime'),
  },
  macos: {
    source: 'macos',
    command: 'bash',
    args: [path.join(REPO_ROOT, 'packages', 'macos', 'scripts', 'install.sh')],
    /** The installer writes to `$HOME/Library/Rime`. */
    env: (scratch) => ({ HOME: scratch }),
    rimeDir: (scratch) => path.join(scratch, 'Library', 'Rime'),
  },
  wsl: {
    source: 'windows',
    command: 'bash',
    args: [path.join(REPO_ROOT, 'packages', 'windows', 'scripts', 'install-from-wsl.sh')],
    /** The installer writes to `$PINYINDUCK_RIME_DIR` when it is set. */
    env: (scratch) => ({ PINYINDUCK_RIME_DIR: path.join(scratch, 'Rime') }),
    rimeDir: (scratch) => path.join(scratch, 'Rime'),
  },
};

const USER_DEFAULT_CUSTOM = [
  '# The user\'s own scheme list, which the installer must keep.',
  'patch:',
  '  schema_list:',
  '    - schema: luna_pinyin',
  '',
].join('\n');

let failures = 0;

function check(ok, message) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
}

/** A file's text, or null when the installer did not write it. */
function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function backups(rimeDir) {
  if (!fs.existsSync(rimeDir)) return [];
  return fs.readdirSync(rimeDir).filter((name) => /^default\.custom\.yaml\..+\.bak$/.test(name));
}

function runInstaller(platform, scratch) {
  const spec = PLATFORMS[platform];
  const result = spawnSync(spec.command, spec.args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...spec.env(scratch) },
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  return result.status;
}

export function checkInstall(platform) {
  const spec = PLATFORMS[platform];
  const source = path.join(REPO_ROOT, 'packages', spec.source, 'rime');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `pinyinduck-install-${platform}-`));
  const rimeDir = spec.rimeDir(scratch);
  const target = path.join(rimeDir, 'default.custom.yaml');
  const ours = fs.readFileSync(path.join(source, 'default.custom.yaml'), 'utf8');

  try {
    console.log(`\n[1/3] fresh install into ${rimeDir}`);
    check(runInstaller(platform, scratch) === 0, 'installer exits 0');
    for (const name of COPIED) {
      const installed = path.join(rimeDir, name);
      const same =
        fs.existsSync(installed) &&
        fs.readFileSync(installed).equals(fs.readFileSync(path.join(source, name)));
      check(same, `${name} is copied byte for byte`);
    }
    check(read(target) === ours, 'default.custom.yaml is created as ours');
    check(!fs.existsSync(path.join(rimeDir, 'rime.lua')), 'rime.lua is not written');
    check(backups(rimeDir).length === 0, 'no backup is made when there was nothing to back up');

    console.log('\n[2/3] the same install again');
    const before = read(target);
    check(runInstaller(platform, scratch) === 0, 'installer exits 0');
    check(before !== null && read(target) === before, 'default.custom.yaml is left as is');
    check(backups(rimeDir).length === 0, 'no backup is made');

    console.log("\n[3/3] over the user's own default.custom.yaml and a stale build/");
    fs.mkdirSync(rimeDir, { recursive: true });
    fs.writeFileSync(target, USER_DEFAULT_CUSTOM, 'utf8');
    fs.mkdirSync(path.join(rimeDir, 'build'), { recursive: true });
    fs.writeFileSync(path.join(rimeDir, 'build', 'pinyinduck.table.bin'), 'stale', 'utf8');
    check(runInstaller(platform, scratch) === 0, 'installer exits 0');
    const merged = read(target) ?? '';
    check(merged.includes('schema: luna_pinyin'), "the user's scheme is kept");
    check(
      merged.includes('schema: pinyinduck') && merged.includes('schema: pinyinduck_trad'),
      'both PinyinDuck schemes are added'
    );
    const made = backups(rimeDir);
    check(
      made.length === 1 &&
        fs.readFileSync(path.join(rimeDir, made[0]), 'utf8') === USER_DEFAULT_CUSTOM,
      "the user's file is backed up unchanged"
    );
    check(!fs.existsSync(path.join(rimeDir, 'build')), 'the stale build/ folder is removed');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const platform = process.argv[2];
  if (!(platform in PLATFORMS)) {
    console.error(`Usage: node scripts/check-rime-install.mjs <${Object.keys(PLATFORMS).join('|')}>`);
    process.exit(2);
  }
  checkInstall(platform);
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nThe ${platform} installer wrote what it promises.`);
}

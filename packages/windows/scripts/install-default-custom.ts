/**
 * Installs PinyinDuck's `default.custom.yaml` into a Rime user folder without replacing
 * the user's own.
 *
 * Called by both installers (`install.ps1` here and `packages/macos/scripts/install.sh`):
 *
 *   tsx packages/windows/scripts/install-default-custom.ts <ours> <target>
 *
 * - No file at <target>: ours is copied as it is.
 * - A file that already has every PinyinDuck entry: nothing is written, so rerunning the
 *   installer changes nothing.
 * - A file missing some: it is backed up next to itself, then the missing entries are
 *   merged in (see `src/rime-user-config.ts`).
 * - A file that cannot be merged safely: it is left untouched, and the entries to add by
 *   hand are printed. The rest of the install still goes ahead.
 */

import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { mergeDefaultCustom, RimeUserConfigError } from '../src/rime-user-config.js';

export type InstallOutcome = 'created' | 'unchanged' | 'merged' | 'skipped';

export interface InstallResult {
  outcome: InstallOutcome;
  /** Where the user's previous file was copied before it was changed. */
  backup?: string;
  /** One line per message for the installer to print. */
  messages: string[];
}

/** `20261106-134502`, so backups sort by time and never overwrite each other. */
export function backupSuffix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function installDefaultCustom(oursPath: string, targetPath: string, now = new Date()): InstallResult {
  const ours = fs.readFileSync(oursPath, 'utf8');
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : null;

  let merged;
  try {
    merged = mergeDefaultCustom(existing, ours);
  } catch (err) {
    if (!(err instanceof RimeUserConfigError)) throw err;
    return {
      outcome: 'skipped',
      messages: [
        `left ${targetPath} unchanged: ${err.message}`,
        'Add these to its patch: map by hand, then deploy:',
        ...ours.split('\n').filter((line) => line.startsWith('  ')).map((line) => `  ${line}`),
      ],
    };
  }

  if (!merged.changed) {
    return { outcome: 'unchanged', messages: ['default.custom.yaml already lists PinyinDuck; left as is'] };
  }
  if (existing === null) {
    fs.writeFileSync(targetPath, merged.content, 'utf8');
    return { outcome: 'created', messages: ['created default.custom.yaml'] };
  }

  const backup = `${targetPath}.${backupSuffix(now)}.bak`;
  fs.copyFileSync(targetPath, backup);
  fs.writeFileSync(targetPath, merged.content, 'utf8');
  return {
    outcome: 'merged',
    backup,
    messages: [
      `added to your default.custom.yaml: ${merged.added.join(', ')}`,
      `your previous file is backed up at ${backup}`,
    ],
  };
}

export function main(args: string[]): void {
  if (args.length !== 2) {
    console.error('Usage: install-default-custom.ts <pinyinduck default.custom.yaml> <target>');
    process.exitCode = 2;
    return;
  }
  const result = installDefaultCustom(args[0], args[1]);
  for (const line of result.messages) console.log(`  ${line}`);
}

// pathToFileURL rather than a `file://` template: on Windows argv[1] is `C:\...`, which
// the template turns into a URL that never matches, and the script would silently do
// nothing when install.ps1 runs it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

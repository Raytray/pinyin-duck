import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backupSuffix, installDefaultCustom, main } from './install-default-custom';
import { RIME_PLATFORMS, renderTemplate, type RimePlatform } from '../src/rime-platform';

const TEMPLATE_PATH = path.resolve(__dirname, '../templates/default.custom.yaml');
const NOW = new Date(2026, 10, 6, 13, 45, 2);

/**
 * Writes the platform's rendered default.custom.yaml, the file the installers actually merge
 * from `packages/<platform>/rime/`, into its own directory so it never shows up in `tmp`.
 */
function renderedOurs(dir: string, platform: RimePlatform): string {
  const file = path.join(dir, `${platform}.default.custom.yaml`);
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  fs.writeFileSync(file, renderTemplate('default.custom.yaml', template, platform), 'utf8');
  return file;
}

let oursDir: string;
let OURS_PATH: string;

beforeAll(() => {
  oursDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-default-custom-ours-'));
  OURS_PATH = renderedOurs(oursDir, 'windows');
});

afterAll(() => {
  fs.rmSync(oursDir, { recursive: true, force: true });
});

describe.each(RIME_PLATFORMS)('installDefaultCustom (%s)', (platform) => {
  beforeAll(() => {
    OURS_PATH = renderedOurs(oursDir, platform);
  });

  let tmp: string;
  let target: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-default-custom-'));
    target = path.join(tmp, 'default.custom.yaml');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('copies ours when the user has no file', () => {
    expect(installDefaultCustom(OURS_PATH, target, NOW).outcome).toBe('created');
    expect(fs.readFileSync(target, 'utf8')).toBe(fs.readFileSync(OURS_PATH, 'utf8'));
    expect(fs.readdirSync(tmp)).toEqual(['default.custom.yaml']);
  });

  it('backs the user file up, merges, and then leaves it alone on a rerun', () => {
    const mine = 'patch:\n  schema_list:\n    - schema: luna_pinyin\n';
    fs.writeFileSync(target, mine);

    const first = installDefaultCustom(OURS_PATH, target, NOW);
    expect(first.outcome).toBe('merged');
    expect(first.backup).toBe(`${target}.20261106-134502.bak`);
    expect(fs.readFileSync(first.backup!, 'utf8')).toBe(mine);
    const merged = fs.readFileSync(target, 'utf8');
    expect(merged).toContain('schema: luna_pinyin');
    expect(merged).toContain('schema: pinyinduck_trad');
    expect(first.messages.join('\n')).toContain('backed up at');

    const second = installDefaultCustom(OURS_PATH, target, new Date(2026, 10, 7));
    expect(second.outcome).toBe('unchanged');
    expect(fs.readFileSync(target, 'utf8')).toBe(merged);
    expect(fs.readdirSync(tmp).sort()).toEqual(['default.custom.yaml', 'default.custom.yaml.20261106-134502.bak']);
  });

  it('leaves a file it cannot merge untouched and says what to add', () => {
    fs.writeFileSync(target, 'patch: [broken\n');
    const result = installDefaultCustom(OURS_PATH, target, NOW);
    expect(result.outcome).toBe('skipped');
    expect(fs.readFileSync(target, 'utf8')).toBe('patch: [broken\n');
    expect(fs.readdirSync(tmp)).toEqual(['default.custom.yaml']);
    expect(result.messages.join('\n')).toContain('- schema: pinyinduck_trad');
  });

  it('lets errors other than an unmergeable file through', () => {
    expect(() => installDefaultCustom(path.join(tmp, 'missing.yaml'), target)).toThrow(/ENOENT/);
  });

  it('pads the backup suffix', () => {
    expect(backupSuffix(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints the result', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-default-custom-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    main([OURS_PATH, path.join(tmp, 'default.custom.yaml')]);
    expect(log).toHaveBeenCalledWith('  created default.custom.yaml');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects the wrong number of arguments', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    main([]);
    expect(error).toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });
});

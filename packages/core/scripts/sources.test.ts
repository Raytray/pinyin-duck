import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SOURCES, type DownloadedSource } from './sources';

/**
 * The real pins. A source that drifts back to a moving URL still builds, and builds a
 * different asset on a different day, so the URLs themselves are checked here.
 */
describe('SOURCES', () => {
  const sources = Object.entries(SOURCES);
  const downloaded = sources.filter((entry): entry is [string, DownloadedSource] => 'url' in entry[1]);

  it.each(sources)('%s has a well-formed SHA-256', (_name, source) => {
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(downloaded)('%s is fetched from a URL that cannot change', (_name, source) => {
    expect(source.url).toMatch(/^https:\/\//);
    // A branch name serves whatever was pushed last.
    expect(source.url).not.toMatch(/\/(master|main|HEAD)\//);
    // mdbg.net only ever serves the latest CC-CEDICT edition.
    expect(source.url).not.toContain('mdbg.net');
  });

  it('pins the GitHub sources to full commit SHAs', () => {
    expect(SOURCES.frequency.url).toMatch(/\/FrequencyWords\/[0-9a-f]{40}\//);
    expect(SOURCES.hsk.url).toMatch(/\/hanyu-shuiping-kaoshi\/[0-9a-f]{40}\//);
  });

  it('caches every downloaded source under its own name', () => {
    const names = downloaded.map(([, s]) => s.cacheName);
    expect(new Set(names).size).toBe(names.length);
  });

  // Checked here as well as at build time, so a checkout that rewrote the file (a line
  // ending conversion, an editor's trailing-newline fix) fails the unit tests rather than
  // only the first build:dict.
  it('commits the CC-CEDICT edition its pin names', () => {
    const file = path.resolve(__dirname, '..', SOURCES.cedict.file);
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    expect(hash).toBe(SOURCES.cedict.sha256);
  });
});

import { describe, it, expect } from 'vitest';
import { SOURCES } from './sources';

/**
 * The real pins. A source that drifts back to a moving URL still builds, and builds a
 * different asset on a different day, so the URLs themselves are checked here.
 */
describe('SOURCES', () => {
  const sources = Object.entries(SOURCES);

  it.each(sources)('%s has a well-formed SHA-256', (_name, source) => {
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(sources)('%s is fetched from a URL that cannot change', (_name, source) => {
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

  it('decompresses exactly the gzipped downloads', () => {
    for (const source of Object.values(SOURCES)) {
      expect(source.gzip).toBe(source.url.endsWith('.gz'));
    }
  });

  it('caches every source under its own name', () => {
    const names = Object.values(SOURCES).map((s) => s.cacheName);
    expect(new Set(names).size).toBe(names.length);
  });
});

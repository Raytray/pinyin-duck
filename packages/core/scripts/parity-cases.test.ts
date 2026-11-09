import { describe, it, expect } from 'vitest';
import { buildParityCases, queriesForWord, SEED_WORDS } from './parity-cases';

describe('queriesForWord', () => {
  it('puts a tone, and a wrong tone, in each position', () => {
    expect(queriesForWord({ syllables: ['ni3', 'hao3'], covers: '' })).toEqual([
      'nihao',
      'ni3hao3',
      "ni'hao",
      "ni3'hao3",
      'ni3 hao3',
      'ni3hao',
      'ni4hao',
      'ni4hao3',
      'nihao3',
      'nihao4',
      'ni3hao4',
    ]);
  });

  it('rejects a seed syllable without a tone digit', () => {
    expect(() => queriesForWord({ syllables: ['ni', 'hao3'], covers: '' })).toThrow(/tone digit/);
  });
});

describe('buildParityCases', () => {
  const cases = buildParityCases();
  const keys = cases.map((c) => `${c.query}\t${c.script}`);

  it('pins no query twice', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pins every seed query in both scripts', () => {
    for (const seed of SEED_WORDS) {
      for (const query of queriesForWord(seed)) {
        expect(keys).toContain(`${query}\tsimplified`);
        expect(keys).toContain(`${query}\ttraditional`);
      }
    }
  });

  it('keeps the queries that caught earlier drift', () => {
    for (const query of ['shi4', 'ta4', 'lv4', 'ni3hao3', 'nihao3', 'ni3hao', 'bian3', 'hang', "xi'an"]) {
      expect(keys).toContain(`${query}\tsimplified`);
    }
  });

  it('includes a word outside the BMP', () => {
    expect(SEED_WORDS.some((seed) => seed.syllables.join(' ') === 'tu3 tuo1 yu2')).toBe(true);
  });
});

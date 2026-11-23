/**
 * Checks the built bigram table against the case it was added for (#50, #51): in
 * `woxianghekafei`, unigram frequencies alone rank 我想和咖啡 above 我想喝咖啡. With the
 * table, the bigram terms must reverse that.
 *
 * It reads the real `bigrams.bin`, which `npm run build:bigrams` writes and CI's core job
 * builds before the tests. Without the file (a checkout that never built it) it is skipped.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { BigramTable } from '../src/bigram/bigram-codec';

const TABLE = path.resolve(__dirname, '../../web/public/bigrams.bin');
const built = fs.existsSync(TABLE);

describe.skipIf(!built)('the built bigram table', () => {
  const table = built ? BigramTable.open(new Uint8Array(fs.readFileSync(TABLE))) : undefined!;

  it('stores every pair of 我想喝咖啡 and of 我想和咖啡', () => {
    for (const [a, b] of [['我', '想'], ['想', '喝'], ['喝', '咖啡'], ['想', '和'], ['和', '咖啡']]) {
      expect(table.score(a, b), `${a} ${b}`).toBeDefined();
    }
  });

  it('ranks 我想喝咖啡 above 我想和咖啡 on bigram terms', () => {
    const drink = table.score('想', '喝')! + table.score('喝', '咖啡')!;
    const and = table.score('想', '和')! + table.score('和', '咖啡')!;
    // A later word scores its bigram in place of its unigram frequency, and 我 and 我→想 are
    // shared, so these two terms decide it (22,208 apart in the 2026-11 build).
    expect(drink).toBeGreaterThan(and);
  });
});

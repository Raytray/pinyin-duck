import { describe, expect, it } from 'vitest';
import { wordGloss } from './word-gloss';

describe('wordGloss: the one-sense gloss under a word of a Sentence candidate', () => {
  it('keeps only the first sense of the short gloss', () => {
    expect(wordGloss('to think / to believe / to suppose')).toBe('to think');
  });

  it('drops a leading parenthetical', () => {
    expect(wordGloss('(of a person) tall / high')).toBe('tall');
  });

  it('keeps a parenthetical that is not at the start', () => {
    expect(wordGloss('coffee (loanword) / CL:杯 bēi')).toBe('coffee (loanword)');
  });

  it('keeps a single sense as it is', () => {
    expect(wordGloss('I')).toBe('I');
  });

  it('falls back to the whole sense when it is only a parenthetical', () => {
    expect(wordGloss('(particle)')).toBe('(particle)');
  });
});

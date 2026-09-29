import { describe, it, expect } from 'vitest';
import { formatGloss } from './gloss';

describe('formatGloss', () => {
  it('joins definitions with a slash', () => {
    expect(formatGloss(['hello', 'hi'])).toBe('hello / hi');
  });

  it('keeps at most three definitions', () => {
    expect(formatGloss(['a', 'b', 'c', 'd'])).toBe('a / b / c');
  });

  it('drops classifier annotations', () => {
    expect(formatGloss(['CL:個|个[ge4]', 'classifier'])).toBe('classifier');
  });

  it('strips internal pronunciation bracket tags', () => {
    expect(formatGloss(['see 塔 [ta3]'])).toBe('see 塔');
  });

  it('collapses runs of internal whitespace left by stripping', () => {
    expect(formatGloss(['a   [ge4]   b'])).toBe('a b');
  });

  it('removes duplicate definitions', () => {
    expect(formatGloss(['to walk', 'to walk', 'to stroll'])).toBe('to walk / to stroll');
  });

  it('truncates a long gloss with an ellipsis', () => {
    const gloss = formatGloss(['x'.repeat(100)], 20);
    expect(gloss).toHaveLength(20);
    expect(gloss.endsWith('…')).toBe(true);
  });

  it('does not truncate at the exact limit', () => {
    expect(formatGloss(['abcde'], 5)).toBe('abcde');
  });

  it('returns an empty string for no definitions', () => {
    expect(formatGloss([])).toBe('');
    expect(formatGloss(['   '])).toBe('');
  });

  describe('cross-reference filtering', () => {
    // A cross-reference is only noise once a real meaning has been kept; otherwise it
    // is the only definition available and dropping it would leave nothing to show.
    it('drops a cross-reference that follows a real definition', () => {
      expect(formatGloss(['to walk', 'variant of 走'])).toBe('to walk');
      expect(formatGloss(['to walk', 'see also 走'])).toBe('to walk');
      expect(formatGloss(['to walk', 'same as 走'])).toBe('to walk');
      expect(formatGloss(['to walk', 'archaic variant of 走'])).toBe('to walk');
    });

    it('keeps a cross-reference when it is the only definition', () => {
      expect(formatGloss(['variant of 走'])).toBe('variant of 走');
      expect(formatGloss(['see also 走'])).toBe('see also 走');
    });

    it('does not match a cross-reference mid-string', () => {
      expect(formatGloss(['a variant of 走'])).toBe('a variant of 走');
    });
  });

  describe('fallback', () => {
    it('falls back to the first raw definition when everything was filtered out', () => {
      // All three are classifiers, so the meaningful text survives only via the
      // raw-definition fallback rather than the cleaned list.
      expect(formatGloss(['CL:個|个[ge4]', 'CL:只|zhi1[zhi1]'])).toBe('CL:個|个[ge4]');
    });

    it('truncates the fallback gloss', () => {
      const gloss = formatGloss(['CL:' + 'y'.repeat(100)], 20);
      expect(gloss).toHaveLength(20);
      expect(gloss.endsWith('…')).toBe(true);
    });
  });
});

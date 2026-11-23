import React from 'react';
import type { Candidate, FixedWord } from '@pinyinduck/core';
import { wordGloss } from '../sentence/word-gloss';

interface SentenceRowProps {
  /** The Sentence candidate's words, in order. */
  words: Candidate[];
  /** The pinyin it leaves to compose next; empty for a full sentence. */
  leftover: string;
  /** The word whose menu is open, or null. */
  openWord: number | null;
  /** The Fixed words held, so the blocks the learner chose are marked. */
  fixedWords: readonly FixedWord[];
  /** A click on word `i`'s block, which opens or closes its menu. */
  onWordClick: (i: number) => void;
}

const isFixed = (word: Candidate, fixedWords: readonly FixedWord[]) =>
  !!word.span && fixedWords.some((f) => f.start === word.span!.start && f.end === word.span!.end);

/**
 * The body of a Sentence candidate's row (variant A of #31): each word its own block, with
 * tone-marked pinyin over the Hanzi over a one-sense gloss. A partial sentence ends with a
 * faded block holding the leftover pinyin, labelled "next", so the row shows what a commit
 * covers and what composes after it.
 *
 * Each word block is a button that opens its word menu (#37). The leftover is not a word and
 * has no menu: a click on it, like one on the gaps between blocks, goes to the row.
 */
export const SentenceRow: React.FC<SentenceRowProps> = ({ words, leftover, openWord, fixedWords, onWordClick }) => (
  <div className="sentence-words">
    {words.map((word, i) => (
      <button
        type="button"
        className={`sentence-word ${openWord === i ? 'open' : ''} ${isFixed(word, fixedWords) ? 'fixed' : ''}`}
        key={i}
        aria-haspopup="menu"
        aria-expanded={openWord === i}
        title="Swap this word or commit through it (Shift+←/→)"
        // Keeps focus, and so the composition, in the editor.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          onWordClick(i);
        }}
      >
        <span className="sentence-word-pinyin">{word.pinyinMarks}</span>
        <span className="sentence-word-hanzi">{word.hanzi}</span>
        <span className="sentence-word-gloss" title={word.shortGloss}>
          {wordGloss(word.shortGloss)}
        </span>
      </button>
    ))}
    {leftover && (
      <span className="sentence-leftover" title="Composes next, after the commit">
        <span className="sentence-word-pinyin" aria-hidden="true">
          &nbsp;
        </span>
        <span className="sentence-leftover-pinyin">{leftover}</span>
        <span className="sentence-leftover-label">next</span>
      </span>
    )}
  </div>
);

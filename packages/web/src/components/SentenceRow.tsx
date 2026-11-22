import React from 'react';
import type { Candidate } from '@pinyinduck/core';
import { wordGloss } from '../sentence/word-gloss';

interface SentenceRowProps {
  /** The Sentence candidate's words, in order. */
  words: Candidate[];
  /** The pinyin it leaves to compose next; empty for a full sentence. */
  leftover: string;
}

/**
 * The body of a Sentence candidate's row (variant A of #31): each word its own block, with
 * tone-marked pinyin over the Hanzi over a one-sense gloss. A partial sentence ends with a
 * faded block holding the leftover pinyin, labelled "next", so the row shows what a commit
 * covers and what composes after it.
 */
export const SentenceRow: React.FC<SentenceRowProps> = ({ words, leftover }) => (
  <div className="sentence-words">
    {words.map((word, i) => (
      <span className="sentence-word" key={i}>
        <span className="sentence-word-pinyin">{word.pinyinMarks}</span>
        <span className="sentence-word-hanzi">{word.hanzi}</span>
        <span className="sentence-word-gloss" title={word.shortGloss}>
          {wordGloss(word.shortGloss)}
        </span>
      </span>
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

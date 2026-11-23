import React from 'react';
import type { OpenWordMenu } from '../hooks/usePinyinDuck';
import { wordGloss } from '../sentence/word-gloss';

interface WordMenuProps {
  menu: OpenWordMenu;
  /** Swaps the word for alternative `n`, from 0. */
  onSwap: (n: number) => void;
  onCommitThrough: () => void;
}

/** Keeps focus, and so the composition, in the editor. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/**
 * The menu of one word of a Sentence candidate (#37), drawn under its row: the alternatives
 * for the word's span, numbered for the digit keys, then "Commit through" the word (Enter).
 * The word in the sentence now is marked among the alternatives.
 */
export const WordMenu: React.FC<WordMenuProps> = ({ menu, onSwap, onCommitThrough }) => (
  <div className="word-menu" role="menu" aria-label={`Alternatives for ${menu.word.hanzi}`}>
    {menu.alternatives.map((alt, n) => {
      const current = alt.hanzi === menu.word.hanzi;
      return (
        <button
          type="button"
          role="menuitem"
          key={alt.id + n}
          className={`word-menu-alt ${current ? 'current' : ''}`}
          aria-current={current || undefined}
          onMouseDown={keepFocus}
          onClick={() => onSwap(n)}
        >
          <kbd>{n + 1}</kbd>
          <span className="word-menu-hanzi">{alt.hanzi}</span>
          <span className="word-menu-pinyin">{alt.pinyinMarks}</span>
          <span className="word-menu-gloss" title={alt.shortGloss}>
            {wordGloss(alt.shortGloss)}
          </span>
        </button>
      );
    })}
    <button
      type="button"
      role="menuitem"
      className="word-menu-commit"
      onMouseDown={keepFocus}
      onClick={onCommitThrough}
    >
      <kbd>Enter</kbd> Commit through <span className="word-menu-through">{menu.word.hanzi}</span>
    </button>
  </div>
);

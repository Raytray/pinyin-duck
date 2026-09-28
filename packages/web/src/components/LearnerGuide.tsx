import React from 'react';
import { HelpCircle, Sparkles, BookMarked, Keyboard } from 'lucide-react';

export const LearnerGuide: React.FC = () => {
  return (
    <section className="learner-guide">
      <div className="guide-header">
        <Sparkles size={18} className="guide-icon" />
        <h2>Designed for Mandarin Learners</h2>
      </div>

      <div className="guide-grid">
        <div className="guide-card">
          <div className="card-title">
            <BookMarked size={16} />
            <h3>Real-Time English Definitions</h3>
          </div>
          <p>
            Standard IMEs assume you already read Chinese characters and only show Hanzi. PinyinDuck displays tone marks and concise English glosses beside every candidate, so you never accidentally pick the wrong character.
          </p>
        </div>

        <div className="guide-card">
          <div className="card-title">
            <Sparkles size={16} />
            <h3>Tone Filtering</h3>
          </div>
          <p>
            Tired of homophone clutter? Append a tone number (1–4) to filter directly. Type <kbd>shi4</kbd> to jump straight to <strong>是</strong> (to be), skipping dozens of second-tone words like <kbd>十</kbd> (ten) or <kbd>时</kbd> (time).
          </p>
        </div>

        <div className="guide-card">
          <div className="card-title">
            <Keyboard size={16} />
            <h3>Keyboard Controls</h3>
          </div>
          <ul className="guide-shortcuts">
            <li><kbd>1</kbd>–<kbd>5</kbd>: Select candidate number</li>
            <li><kbd>Space</kbd>: Commit first candidate</li>
            <li><kbd>Enter</kbd>: Output raw English/pinyin</li>
            <li><kbd>[</kbd> / <kbd>]</kbd> or <kbd>PgUp</kbd> / <kbd>PgDn</kbd>: Flip pages</li>
            <li><kbd>Esc</kbd>: Clear composition buffer</li>
          </ul>
        </div>
      </div>
    </section>
  );
};

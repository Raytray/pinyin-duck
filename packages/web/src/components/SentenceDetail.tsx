import React from 'react';
import type { Candidate, DetailView } from '@pinyinduck/core';
import type { OpenCandidateDetail } from '../hooks/usePinyinDuck';

/** Senses shown per sense group of each word; the rest are counted ("+3 more"). */
const SENSES_PER_GROUP = 2;

interface SentenceDetailProps {
  /** The open detail of a Sentence candidate (its `candidate.words` is set). */
  detail: OpenCandidateDetail;
  /** Commits what the candidate covers, as Space or its number would. */
  onCommit: () => void;
}

/**
 * The Candidate detail of a Sentence candidate (variant A of #31): a header with the whole
 * sentence and its reading, then one section per word, one under another, each with its
 * Hanzi, reading and counterpart and every sense group capped at its top two senses. Until
 * the detail file is in, each word's short gloss stands in for its senses.
 */
export const SentenceDetail: React.FC<SentenceDetailProps> = ({ detail, onCommit }) => {
  const { candidate, status, wordViews } = detail;
  const words = candidate.words ?? [];
  const leftover = candidate.remainingPinyin;
  return (
    <section
      className="candidate-detail"
      aria-label="Candidate detail"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="detail-head">
        <button
          type="button"
          className="detail-hanzi"
          onClick={onCommit}
          title={`Use ${candidate.hanzi}`}
          aria-label={`Use ${candidate.hanzi}`}
        >
          {candidate.hanzi}
        </button>
        <div className="detail-head-text">
          <span className="detail-reading">{candidate.pinyinMarks}</span>
          {leftover && <span className="detail-then">then compose ‘{leftover}’</span>}
        </div>
      </div>

      {status === 'loading' && <p className="detail-status">Loading details…</p>}
      {status === 'failed' && (
        <p className="detail-status failed" role="status">
          Couldn't load details
        </p>
      )}

      {words.map((word, i) => (
        <WordSection key={i} word={word} view={status === 'ready' ? wordViews?.[i] : undefined} />
      ))}
    </section>
  );
};

/** One word of the sentence: its head line, then its capped senses (or its short gloss). */
const WordSection: React.FC<{ word: Candidate; view?: DetailView }> = ({ word, view }) => (
  <div className="detail-word">
    <div className="detail-word-head">
      <span className="detail-word-hanzi">{word.hanzi}</span>
      <span className="detail-reading">{word.pinyinMarks}</span>
      {view?.counterpart && <span className="detail-counterpart">{view.counterpart}</span>}
    </div>
    {!view && <p className="detail-gloss">{word.shortGloss}</p>}
    {view?.groups.map((group, i) => {
      const hidden = group.senses.length - SENSES_PER_GROUP;
      return (
        <div className="detail-group" key={i}>
          {group.heading && <h4 className="detail-heading">{group.heading}</h4>}
          {group.partOfSpeech && <p className="detail-pos">{group.partOfSpeech}</p>}
          {group.senses.length > 0 && (
            <ol className="detail-senses">
              {group.senses.slice(0, SENSES_PER_GROUP).map((sense) => (
                <li key={sense.number} className={sense.proper ? 'detail-sense proper' : 'detail-sense'}>
                  {sense.text}
                </li>
              ))}
            </ol>
          )}
          {hidden > 0 && <p className="detail-more">+{hidden} more</p>}
        </div>
      );
    })}
  </div>
);

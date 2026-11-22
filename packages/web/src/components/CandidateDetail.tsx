import React from 'react';
import type { OpenCandidateDetail } from '../hooks/usePinyinDuck';

interface CandidateDetailProps {
  detail: OpenCandidateDetail;
  /** Commits the candidate, as Space or its number would. */
  onCommit: () => void;
}

/**
 * The Candidate detail, drawn inline under the highlighted row (the W2 accordion of #5).
 *
 * It draws whatever the core detail view returns, line for line, so the web and Android
 * agree on what a detail says. Until the detail file is in, the short gloss stands in for
 * the senses. Pressing inside it never takes focus from the editor.
 */
export const CandidateDetail: React.FC<CandidateDetailProps> = ({ detail, onCommit }) => {
  const { candidate, status, view } = detail;
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
          {view?.counterpart && <span className="detail-counterpart">{view.counterpart}</span>}
        </div>
      </div>

      {status !== 'ready' && <p className="detail-gloss">{candidate.shortGloss}</p>}
      {status === 'loading' && <p className="detail-status">Loading details…</p>}
      {status === 'failed' && (
        <p className="detail-status failed" role="status">
          Couldn't load details
        </p>
      )}

      {view?.groups.map((group, i) => (
        <div className="detail-group" key={i}>
          {group.heading && <h4 className="detail-heading">{group.heading}</h4>}
          {group.partOfSpeech && <p className="detail-pos">{group.partOfSpeech}</p>}
          {group.tags.length > 0 && (
            <ul className="detail-tags">
              {group.tags.map((tag) => (
                <li key={tag} className="detail-tag">
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {group.senses.length > 0 && (
            <ol className="detail-senses">
              {group.senses.map((sense) => (
                <li key={sense.number} className={sense.proper ? 'detail-sense proper' : 'detail-sense'}>
                  {sense.text}
                </li>
              ))}
            </ol>
          )}
          {group.measureWords.length > 0 && (
            <p className="detail-mw">
              <span className="detail-mw-label">Measure words</span> {group.measureWords.join(' · ')}
            </p>
          )}
        </div>
      ))}
    </section>
  );
};

import React from 'react';
import { Candidate } from '@pinyinduck/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CandidateDetail } from './CandidateDetail';
import { SentenceDetail } from './SentenceDetail';
import { SentenceRow } from './SentenceRow';
import type { OpenCandidateDetail } from '../hooks/usePinyinDuck';

interface CandidatePopupProps {
  candidates: Candidate[];
  selectedIndex: number;
  currentPage: number;
  totalPages: number;
  compositionBuffer: string;
  dictionaryStatus: 'loading' | 'ready' | 'error';
  onSelectCandidate: (index: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onHoverIndex: (index: number) => void;
  /** The open Candidate detail, drawn under its row, or null. */
  detail: OpenCandidateDetail | null;
  onToggleDetail: (index: number) => void;
}

export const CandidatePopup: React.FC<CandidatePopupProps> = ({
  candidates,
  selectedIndex,
  currentPage,
  totalPages,
  compositionBuffer,
  dictionaryStatus,
  onSelectCandidate,
  onNextPage,
  onPrevPage,
  onHoverIndex,
  detail,
  onToggleDetail,
}) => {
  // An empty candidate list means "no match" only once the dictionary is loaded.
  // Before that the search has not run at all, so claiming no match would be a lie.
  if (candidates.length === 0) {
    if (dictionaryStatus !== 'ready') {
      return (
        <div className="candidate-popup empty">
          <div className="candidate-empty-msg">
            {dictionaryStatus === 'loading' ? (
              <span>
                Loading dictionary for <strong>"{compositionBuffer}"</strong>...
              </span>
            ) : (
              <span>
                Dictionary unavailable, cannot look up <strong>"{compositionBuffer}"</strong>
              </span>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="candidate-popup empty">
        <div className="candidate-empty-msg">
          <span>No exact match for <strong>"{compositionBuffer}"</strong></span>
          <span className="candidate-empty-hint">Press <kbd>Enter</kbd> to insert English</span>
        </div>
      </div>
    );
  }

  return (
    <div className="candidate-popup shadow-xl" role="listbox" aria-label="Pinyin Candidates">
      {/* Active composition header */}
      <div className="candidate-header">
        <span className="candidate-buffer-tag">Pinyin:</span>
        <span className="candidate-buffer-text">{compositionBuffer}</span>
        <span className="candidate-count-tag">
          {currentPage + 1} / {totalPages}
        </span>
      </div>

      {/* Candidate list items */}
      <div className="candidate-list">
        {candidates.map((cand, idx) => {
          const isSelected = idx === selectedIndex;
          const displayNum = idx + 1;

          const detailHere = detail?.index === idx;

          return (
            <React.Fragment key={cand.id + idx}>
              <div
                role="option"
                aria-selected={isSelected}
                aria-expanded={detailHere}
                className={`candidate-item ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectCandidate(idx)}
                // While a detail is open the highlight moves by keyboard or ⓘ only: following
                // the pointer would move the detail, and the rows with it, under the pointer.
                onMouseEnter={detail ? undefined : () => onHoverIndex(idx)}
              >
                {cand.words ? (
                  <>
                    <span className="candidate-num">{displayNum}</span>
                    <SentenceRow words={cand.words} leftover={cand.remainingPinyin} />
                  </>
                ) : (
                  <>
                    <div className="candidate-left">
                      <span className="candidate-num">{displayNum}</span>
                      <span className="candidate-hanzi">{cand.hanzi}</span>
                      <span className="candidate-pinyin">{cand.pinyinMarks}</span>
                    </div>
                    <div className="candidate-gloss" title={cand.shortGloss}>
                      {cand.shortGloss}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className={`candidate-info ${detailHere ? 'on' : ''}`}
                  aria-label={`Details for ${cand.hanzi}`}
                  aria-pressed={detailHere}
                  title="Details (Tab)"
                  // Keeps focus, and so the composition, in the editor.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDetail(idx);
                  }}
                >
                  ⓘ
                </button>
              </div>
              {detailHere &&
                (cand.words ? (
                  <SentenceDetail detail={detail} onCommit={() => onSelectCandidate(idx)} />
                ) : (
                  <CandidateDetail detail={detail} onCommit={() => onSelectCandidate(idx)} />
                ))}
            </React.Fragment>
          );
        })}
      </div>

      {/* Candidate footer navigation & hints */}
      <div className="candidate-footer">
        <div className="candidate-hints">
          <span className="hint-pill">
            <kbd>Space</kbd> Commit #1
          </span>
          <span className="hint-pill">
            <kbd>1</kbd>–<kbd>{candidates.length}</kbd> Pick
          </span>
          <span className="hint-pill">
            <kbd>Enter</kbd> Raw
          </span>
          <span className="hint-pill">
            <kbd>Tab</kbd> Details
          </span>
        </div>
        <div className="candidate-pager">
          <button
            type="button"
            className="pager-btn"
            disabled={currentPage === 0}
            onClick={onPrevPage}
            title="Previous page (PageUp or [)"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="pager-text">
            {currentPage + 1}/{totalPages}
          </span>
          <button
            type="button"
            className="pager-btn"
            disabled={currentPage >= totalPages - 1}
            onClick={onNextPage}
            title="Next page (PageDown or ])"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

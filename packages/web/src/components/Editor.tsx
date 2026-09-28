import React, { useRef, useEffect } from 'react';
import { CandidatePopup } from './CandidatePopup';
import { Candidate } from '@pinyinduck/core';

interface EditorProps {
  committedText: string;
  compositionBuffer: string;
  isComposing: boolean;
  pageCandidates: Candidate[];
  selectedIndex: number;
  currentPage: number;
  totalPages: number;
  onSelectCandidate: (index: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onSetSelectedIndex: (index: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onChangeCommittedText: (text: string) => void;
}

export const Editor: React.FC<EditorProps> = ({
  committedText,
  compositionBuffer,
  isComposing,
  pageCandidates,
  selectedIndex,
  currentPage,
  totalPages,
  onSelectCandidate,
  onNextPage,
  onPrevPage,
  onSetSelectedIndex,
  onKeyDown,
  onChangeCommittedText,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on load
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleClickArea = () => {
    textareaRef.current?.focus();
  };

  return (
    <div className="editor-container" onClick={handleClickArea}>
      <div className="editor-surface">
        {/* Render committed text and active composition underline inline */}
        <div className="text-display">
          <span className="committed-content">
            {committedText || (
              <span className="placeholder-text">
                Start typing Pinyin here (e.g. "nihao", "xiexie", "shi4", "ta1")...
              </span>
            )}
          </span>

          {isComposing && (
            <span className="composition-marker">
              <span className="composition-underline">{compositionBuffer}</span>
              <span className="composition-caret" />
            </span>
          )}
        </div>

        {/* Floating Candidate Popup tethered directly below composition */}
        {isComposing && (
          <div className="candidate-anchor">
            <CandidatePopup
              candidates={pageCandidates}
              selectedIndex={selectedIndex}
              currentPage={currentPage}
              totalPages={totalPages}
              compositionBuffer={compositionBuffer}
              onSelectCandidate={onSelectCandidate}
              onNextPage={onNextPage}
              onPrevPage={onPrevPage}
              onHoverIndex={onSetSelectedIndex}
            />
          </div>
        )}

        {/* Hidden active textarea capturing keystrokes */}
        <textarea
          ref={textareaRef}
          className="keystroke-capture"
          value=""
          onChange={() => {}}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          aria-label="Mandarin Pinyin Composition Input"
        />
      </div>

      <div className="editor-statusbar">
        <span className="status-item">
          <strong>IME Mode:</strong> {isComposing ? 'Composing...' : 'Ready'}
        </span>
        <span className="status-item">
          <strong>Length:</strong> {committedText.length} characters
        </span>
        <span className="status-hint">
          Click editor or press any key to type
        </span>
      </div>
    </div>
  );
};

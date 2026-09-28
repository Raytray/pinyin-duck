import React, { useRef, useEffect } from 'react';
import { CandidatePopup } from './CandidatePopup';
import { Candidate } from '@pinyinduck/core';

interface EditorProps {
  committedText: string;
  compositionBuffer: string;
  insertPos: number;
  isComposing: boolean;
  pageCandidates: Candidate[];
  selectedIndex: number;
  currentPage: number;
  totalPages: number;
  cursorToRestore: React.MutableRefObject<number | null>;
  onSelectCandidate: (index: number) => void;
  onNextPage: () => void;
  onPrevPage: () => void;
  onSetSelectedIndex: (index: number) => void;
  onSetInsertPos: (pos: number) => void;
  onKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    textarea: HTMLTextAreaElement | null
  ) => void;
  onChangeTextarea: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export const Editor: React.FC<EditorProps> = ({
  committedText,
  compositionBuffer,
  insertPos,
  isComposing,
  pageCandidates,
  selectedIndex,
  currentPage,
  totalPages,
  cursorToRestore,
  onSelectCandidate,
  onNextPage,
  onPrevPage,
  onSetSelectedIndex,
  onSetInsertPos,
  onKeyDown,
  onChangeTextarea,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on load
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Restore cursor position after state changes (deleting, inserting, committing)
  useEffect(() => {
    if (cursorToRestore.current !== null && textareaRef.current) {
      const pos = Math.min(cursorToRestore.current, committedText.length);
      textareaRef.current.setSelectionRange(pos, pos);
      cursorToRestore.current = null;
    }
  }, [committedText, cursorToRestore]);

  const handleTextareaSelectOrClick = () => {
    if (textareaRef.current && !isComposing) {
      onSetInsertPos(textareaRef.current.selectionStart);
    }
  };

  const handleContainerClick = () => {
    textareaRef.current?.focus();
  };

  // Slices of committed text around active composition
  const committedBefore = committedText.slice(0, insertPos);
  const committedAfter = committedText.slice(insertPos);

  return (
    <div className="editor-container" onClick={handleContainerClick}>
      <div className="editor-surface">
        {/* Visual composition layer: active when composing */}
        {isComposing && (
          <div className="text-display composition-active" aria-hidden="true">
            <span className="text-segment">{committedBefore}</span>
            <span className="composition-marker">
              <span className="composition-underline">{compositionBuffer}</span>
              <span className="composition-caret" />
            </span>
            <span className="text-segment">{committedAfter}</span>
          </div>
        )}

        {/* Real interactive textarea: always captures input, selection, Ctrl+A, Backspace */}
        <textarea
          ref={textareaRef}
          className={`editor-textarea ${isComposing ? 'composing' : ''}`}
          value={committedText}
          onChange={onChangeTextarea}
          onKeyDown={(e) => onKeyDown(e, textareaRef.current)}
          onSelect={handleTextareaSelectOrClick}
          onClick={handleTextareaSelectOrClick}
          onKeyUp={handleTextareaSelectOrClick}
          placeholder={
            isComposing
              ? ''
              : 'Start typing Pinyin here (e.g. "nihao", "shi4", "ta1", "zhongguo")...'
          }
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          aria-label="Pinyin composition input"
        />

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
      </div>

      <div className="editor-statusbar">
        <span className="status-item">
          <strong>IME Mode:</strong> {isComposing ? 'Composing Pinyin...' : 'Ready'}
        </span>
        <span className="status-item">
          <strong>Length:</strong> {committedText.length} characters
        </span>
        <span className="status-hint">
          Supports <kbd>Ctrl+A</kbd>, <kbd>Backspace</kbd>, <kbd>Delete</kbd>, <kbd>Space</kbd>
        </span>
      </div>
    </div>
  );
};

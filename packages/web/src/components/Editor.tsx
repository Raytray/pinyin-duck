import React, { useRef, useEffect, useState } from 'react';
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
  dictionaryStatus: 'loading' | 'ready' | 'error';
  entryCount: number;
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
  dictionaryStatus,
  entryCount,
  onSelectCandidate,
  onNextPage,
  onPrevPage,
  onSetSelectedIndex,
  onSetInsertPos,
  onKeyDown,
  onChangeTextarea,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState<boolean>(true);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
    setIsFocused(true);
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
    setIsFocused(true);
  };

  // Slices of committed text around active composition
  const committedBefore = committedText.slice(0, insertPos);
  const committedAfter = committedText.slice(insertPos);

  return (
    <div
      className={`editor-container ${isFocused ? 'focused' : ''}`}
      onClick={handleContainerClick}
    >
      <div className="editor-surface">
        {/* Empty state: prominent blinking cursor indicating editor is ready */}
        {committedText === '' && !isComposing && (
          <div className="empty-placeholder-layer" aria-hidden="true">
            {isFocused && <span className="active-blinking-cursor" />}
            <span className="placeholder-text">
              Start typing Pinyin here (e.g. "nihao", "shi4", "ta1", "zhongguo")...
            </span>
          </div>
        )}

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
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
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
              dictionaryStatus={dictionaryStatus}
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
          <span className={`status-dot ${isFocused ? 'active' : 'idle'}`} />
          <strong>Editor:</strong>{' '}
          {isFocused
            ? isComposing
              ? 'Composing Pinyin...'
              : 'Active (Ready to type)'
            : 'Idle (Click to focus)'}
        </span>
        <span className="status-item" data-testid="dictionary-status">
          <span
            className={`status-dot ${
              dictionaryStatus === 'ready' ? 'active' : dictionaryStatus === 'error' ? 'error' : 'idle'
            }`}
          />
          <strong>Dictionary:</strong>{' '}
          {dictionaryStatus === 'ready'
            ? `${entryCount.toLocaleString('en-US')} entries`
            : dictionaryStatus === 'loading'
              ? 'Loading...'
              : 'Failed to load'}
        </span>
          <span className="status-item" data-testid="text-length">
            <strong>Length:</strong> {committedText.length} characters
          </span>
        <span className="status-hint">
          Supports <kbd>Ctrl+A</kbd>, <kbd>Backspace</kbd>, <kbd>Space</kbd>, <kbd>1-9</kbd>
        </span>
      </div>
    </div>
  );
};

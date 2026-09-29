import { useState, useMemo, useCallback, useRef } from 'react';
import {
  PinyinSearchEngine,
  SEED_DICTIONARY,
  Candidate,
  ScriptType,
} from '@pinyinduck/core';

export interface UsePinyinDuckOptions {
  pageSize?: number;
  initialScript?: ScriptType;
}

const PUNCTUATION_MAP: Record<string, string> = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
};

export function usePinyinDuck(options: UsePinyinDuckOptions = {}) {
  const { pageSize = 5, initialScript = 'simplified' } = options;

  const [engine] = useState(() => new PinyinSearchEngine(SEED_DICTIONARY));
  const [script, setScript] = useState<ScriptType>(initialScript);
  const [committedText, setCommittedText] = useState<string>('');
  const [compositionBuffer, setCompositionBuffer] = useState<string>('');
  const [insertPos, setInsertPos] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Target cursor position to restore on next render
  const cursorToRestore = useRef<number | null>(null);

  // Search candidates whenever composition buffer or script changes
  const searchResult = useMemo(() => {
    if (!compositionBuffer) {
      return { query: '', segments: [], candidates: [], total: 0 };
    }
    return engine.search(compositionBuffer, {
      script,
      limit: 50,
      offset: 0,
    });
  }, [engine, compositionBuffer, script]);

  const allCandidates = searchResult.candidates;
  const totalCandidates = allCandidates.length;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / pageSize));

  // Get current page slice
  const pageCandidates = useMemo(() => {
    const start = currentPage * pageSize;
    return allCandidates.slice(start, start + pageSize);
  }, [allCandidates, currentPage, pageSize]);

  // Select a candidate by visible page index (0 to pageSize - 1)
  const selectCandidate = useCallback(
    (indexOnPage: number) => {
      const candidate = pageCandidates[indexOnPage];
      if (!candidate) return;

      const before = committedText.slice(0, insertPos);
      const after = committedText.slice(insertPos);
      const newCommitted = before + candidate.hanzi + after;
      const newCursor = insertPos + candidate.hanzi.length;

      setCommittedText(newCommitted);
      cursorToRestore.current = newCursor;

      // If candidate had remaining pinyin (partial match), keep remaining in buffer
      if (candidate.remainingPinyin) {
        setCompositionBuffer(candidate.remainingPinyin);
        setInsertPos(newCursor);
        setCurrentPage(0);
        setSelectedIndex(0);
      } else {
        // Full consumption
        setCompositionBuffer('');
        setInsertPos(newCursor);
        setCurrentPage(0);
        setSelectedIndex(0);
      }
    },
    [pageCandidates, committedText, insertPos]
  );

  // Commit raw untranslated pinyin text
  const commitRaw = useCallback(() => {
    if (!compositionBuffer) return;
    const before = committedText.slice(0, insertPos);
    const after = committedText.slice(insertPos);
    const newCommitted = before + compositionBuffer + after;
    const newCursor = insertPos + compositionBuffer.length;

    setCommittedText(newCommitted);
    cursorToRestore.current = newCursor;
    setCompositionBuffer('');
    setInsertPos(newCursor);
    setCurrentPage(0);
    setSelectedIndex(0);
  }, [compositionBuffer, committedText, insertPos]);

  // Cancel composition
  const cancelComposition = useCallback(() => {
    setCompositionBuffer('');
    setCurrentPage(0);
    setSelectedIndex(0);
  }, []);

  // Navigation
  const nextPage = useCallback(() => {
    setCurrentPage((prev) => (prev + 1 < totalPages ? prev + 1 : prev));
    setSelectedIndex(0);
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => (prev > 0 ? prev - 1 : 0));
    setSelectedIndex(0);
  }, []);

  const moveSelection = useCallback(
    (direction: 'next' | 'prev') => {
      if (pageCandidates.length === 0) return;
      if (direction === 'next') {
        if (selectedIndex + 1 < pageCandidates.length) {
          setSelectedIndex((i) => i + 1);
        } else if (currentPage + 1 < totalPages) {
          setCurrentPage((p) => p + 1);
          setSelectedIndex(0);
        }
      } else {
        if (selectedIndex > 0) {
          setSelectedIndex((i) => i - 1);
        } else if (currentPage > 0) {
          setCurrentPage((p) => p - 1);
          setSelectedIndex(pageSize - 1);
        }
      }
    },
    [pageCandidates.length, selectedIndex, currentPage, totalPages, pageSize]
  );

  // Direct change handler on textarea (e.g. paste, native text deletion)
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (compositionBuffer.length === 0) {
        setCommittedText(e.target.value);
        setInsertPos(e.target.selectionStart || 0);
      }
    },
    [compositionBuffer.length]
  );

  // Keyboard handler for the editor
  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      textarea: HTMLTextAreaElement | null
    ) => {
      const isComposing = compositionBuffer.length > 0;
      const start = textarea?.selectionStart ?? insertPos;
      const end = textarea?.selectionEnd ?? insertPos;
      const hasSelection = start !== end;

      // Hotkey: Ctrl+A / Cmd+A (Select All)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (isComposing) {
          // Cancel active composition and select all text
          cancelComposition();
        }
        if (textarea) {
          textarea.select();
        }
        return;
      }

      // Hotkey: Ctrl+C / Cmd+C (Copy) or Ctrl+X / Cmd+X (Cut)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && !isComposing) {
        if (hasSelection && textarea) {
          const selected = committedText.slice(start, end);
          navigator.clipboard.writeText(selected).catch(() => {});
          const newText = committedText.slice(0, start) + committedText.slice(end);
          setCommittedText(newText);
          cursorToRestore.current = start;
          setInsertPos(start);
          e.preventDefault();
        }
        return;
      }

      // Other Ctrl/Cmd/Alt shortcuts (e.g. Ctrl+Z, Ctrl+V, Ctrl+C): let native browser handle
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Handle Escape: cancel composition
      if (e.key === 'Escape') {
        if (isComposing) {
          e.preventDefault();
          cancelComposition();
        }
        return;
      }

      // Handle Backspace:
      if (e.key === 'Backspace') {
        if (isComposing) {
          e.preventDefault();
          const nextBuffer = compositionBuffer.slice(0, -1);
          setCompositionBuffer(nextBuffer);
          setCurrentPage(0);
          setSelectedIndex(0);
          return;
        }

        // When NOT composing: delete accepted characters!
        e.preventDefault();
        if (hasSelection) {
          // Delete selected accepted characters
          const newText = committedText.slice(0, start) + committedText.slice(end);
          setCommittedText(newText);
          cursorToRestore.current = start;
          setInsertPos(start);
        } else if (start > 0) {
          // Delete one character before cursor
          // Use Array.from to correctly handle UTF-16 surrogate pairs / emojis
          const beforeArr = Array.from(committedText.slice(0, start));
          const removed = beforeArr.pop() || '';
          const removeLen = removed.length;
          const newStart = start - removeLen;
          const newText = committedText.slice(0, newStart) + committedText.slice(start);
          setCommittedText(newText);
          cursorToRestore.current = newStart;
          setInsertPos(newStart);
        }
        return;
      }

      // Handle Delete (Forward delete):
      if (e.key === 'Delete' && !isComposing) {
        e.preventDefault();
        if (hasSelection) {
          const newText = committedText.slice(0, start) + committedText.slice(end);
          setCommittedText(newText);
          cursorToRestore.current = start;
          setInsertPos(start);
        } else if (start < committedText.length) {
          const afterArr = Array.from(committedText.slice(start));
          const removed = afterArr.shift() || '';
          const removeLen = removed.length;
          const newText = committedText.slice(0, start) + committedText.slice(start + removeLen);
          setCommittedText(newText);
          cursorToRestore.current = start;
          setInsertPos(start);
        }
        return;
      }

      // Handle Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isComposing) {
          commitRaw();
        } else {
          // Insert newline in accepted text
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newText = before + '\n' + after;
          const newCursor = start + 1;
          setCommittedText(newText);
          cursorToRestore.current = newCursor;
          setInsertPos(newCursor);
        }
        return;
      }

      // Handle Space
      if (e.key === ' ') {
        e.preventDefault();
        if (isComposing) {
          if (pageCandidates.length > 0) {
            selectCandidate(selectedIndex);
          } else {
            commitRaw();
          }
        } else {
          // Insert space in accepted text
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newText = before + ' ' + after;
          const newCursor = start + 1;
          setCommittedText(newText);
          cursorToRestore.current = newCursor;
          setInsertPos(newCursor);
        }
        return;
      }

      // Handle Number Keys 0-9
      // While composing, a digit is always a candidate-pick shortcut and is never
      // appended to the buffer. Out-of-range digits are swallowed instead of falling
      // through, so the buffer can only ever grow with letters. This makes tone
      // numbers (e.g. "shi4") unreachable from the keyboard; tone filtering remains
      // available to callers of the search engine itself.
      if (/^[0-9]$/.test(e.key)) {
        if (!isComposing) {
          return; // Plain number input in committed text.
        }
        e.preventDefault();
        const digit = parseInt(e.key, 10);
        if (digit >= 1 && digit <= pageCandidates.length) {
          selectCandidate(digit - 1);
        }
        return;
      }

      // Handle Page Navigation with [ and ] or PageUp / PageDown
      if (isComposing) {
        if (e.key === 'PageDown' || e.key === ']') {
          e.preventDefault();
          nextPage();
          return;
        }
        if (e.key === 'PageUp' || e.key === '[') {
          e.preventDefault();
          prevPage();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          e.preventDefault();
          moveSelection('next');
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
          e.preventDefault();
          moveSelection('prev');
          return;
        }
      } else {
        // Not composing: Arrow keys move cursor naturally in textarea
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          // Let native cursor navigation handle it
          setTimeout(() => {
            if (textarea) {
              setInsertPos(textarea.selectionStart);
            }
          }, 0);
          return;
        }
      }

      // Handle Chinese Punctuation
      if (PUNCTUATION_MAP[e.key]) {
        e.preventDefault();
        const mappedPunct = PUNCTUATION_MAP[e.key];
        if (isComposing) {
          const chosenHanzi =
            pageCandidates.length > 0 ? pageCandidates[selectedIndex].hanzi : compositionBuffer;
          const before = committedText.slice(0, insertPos);
          const after = committedText.slice(insertPos);
          const newCommitted = before + chosenHanzi + mappedPunct + after;
          const newCursor = insertPos + chosenHanzi.length + mappedPunct.length;

          setCommittedText(newCommitted);
          cursorToRestore.current = newCursor;
          setCompositionBuffer('');
          setInsertPos(newCursor);
          setCurrentPage(0);
          setSelectedIndex(0);
        } else {
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newCommitted = before + mappedPunct + after;
          const newCursor = start + mappedPunct.length;

          setCommittedText(newCommitted);
          cursorToRestore.current = newCursor;
          setInsertPos(newCursor);
        }
        return;
      }

      // Handle alphabetic letters (a-z, A-Z) and apostrophe (') -> Pinyin Composition
      if (/^[a-zA-Z']$/.test(e.key)) {
        e.preventDefault();
        if (!isComposing) {
          // If there was an active selection, delete it when starting composition
          if (hasSelection) {
            const newText = committedText.slice(0, start) + committedText.slice(end);
            setCommittedText(newText);
            setInsertPos(start);
          } else {
            setInsertPos(start);
          }
        }
        setCompositionBuffer((prev) => prev + e.key.toLowerCase());
        setCurrentPage(0);
        setSelectedIndex(0);
        return;
      }
    },
    [
      compositionBuffer,
      pageCandidates,
      selectedIndex,
      insertPos,
      committedText,
      selectCandidate,
      commitRaw,
      cancelComposition,
      nextPage,
      prevPage,
      moveSelection,
    ]
  );

  const toggleScript = useCallback(() => {
    setScript((prev) => (prev === 'simplified' ? 'traditional' : 'simplified'));
  }, []);

  const clearAll = useCallback(() => {
    setCommittedText('');
    setCompositionBuffer('');
    setInsertPos(0);
    setCurrentPage(0);
    setSelectedIndex(0);
    cursorToRestore.current = 0;
  }, []);

  return {
    script,
    setScript,
    toggleScript,
    committedText,
    setCommittedText,
    insertPos,
    setInsertPos,
    compositionBuffer,
    isComposing: compositionBuffer.length > 0,
    pageCandidates,
    allCandidates,
    selectedIndex,
    setSelectedIndex,
    currentPage,
    totalPages,
    totalCandidates,
    selectCandidate,
    commitRaw,
    cancelComposition,
    nextPage,
    prevPage,
    handleKeyDown,
    handleTextareaChange,
    cursorToRestore,
    clearAll,
  };
}

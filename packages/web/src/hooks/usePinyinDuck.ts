import { useState, useMemo, useCallback } from 'react';
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
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

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

      setCommittedText((prev) => prev + candidate.hanzi);

      // If candidate had remaining pinyin (partial match), keep remaining in buffer
      if (candidate.remainingPinyin) {
        setCompositionBuffer(candidate.remainingPinyin);
        setCurrentPage(0);
        setSelectedIndex(0);
      } else {
        // Full consumption
        setCompositionBuffer('');
        setCurrentPage(0);
        setSelectedIndex(0);
      }
    },
    [pageCandidates]
  );

  // Commit raw untranslated pinyin text
  const commitRaw = useCallback(() => {
    if (!compositionBuffer) return;
    setCommittedText((prev) => prev + compositionBuffer);
    setCompositionBuffer('');
    setCurrentPage(0);
    setSelectedIndex(0);
  }, [compositionBuffer]);

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

  // Keyboard handler for the editor
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const isComposing = compositionBuffer.length > 0;

      // Handle Escape: cancel composition
      if (e.key === 'Escape') {
        if (isComposing) {
          e.preventDefault();
          cancelComposition();
        }
        return;
      }

      // Handle Backspace
      if (e.key === 'Backspace') {
        if (isComposing) {
          e.preventDefault();
          setCompositionBuffer((prev) => prev.slice(0, -1));
          setCurrentPage(0);
          setSelectedIndex(0);
        }
        // If not composing, default textarea backspace will delete from committedText naturally
        return;
      }

      // Handle Enter
      if (e.key === 'Enter') {
        if (isComposing) {
          e.preventDefault();
          commitRaw();
          return;
        }
        // If not composing, let Enter create newline naturally
        return;
      }

      // Handle Space
      if (e.key === ' ') {
        if (isComposing) {
          e.preventDefault();
          // If we have candidates, commit the selected one
          if (pageCandidates.length > 0) {
            selectCandidate(selectedIndex);
          } else {
            commitRaw();
          }
          return;
        }
        // If not composing, regular space
        return;
      }

      // Handle Number Keys 1-9 to select candidate
      if (/^[1-9]$/.test(e.key)) {
        if (isComposing) {
          // If user typed tone number at the end of a syllable without candidates selected
          // Check if key corresponds to candidate index
          const digit = parseInt(e.key, 10);
          if (digit <= pageCandidates.length) {
            e.preventDefault();
            selectCandidate(digit - 1);
            return;
          }
        }
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
      }

      // Handle Chinese Punctuation
      if (PUNCTUATION_MAP[e.key]) {
        e.preventDefault();
        const mappedPunct = PUNCTUATION_MAP[e.key];
        if (isComposing) {
          if (pageCandidates.length > 0) {
            const chosen = pageCandidates[selectedIndex];
            setCommittedText((prev) => prev + chosen.hanzi + mappedPunct);
          } else {
            setCommittedText((prev) => prev + compositionBuffer + mappedPunct);
          }
          setCompositionBuffer('');
          setCurrentPage(0);
          setSelectedIndex(0);
        } else {
          setCommittedText((prev) => prev + mappedPunct);
        }
        return;
      }

      // Handle alphabetic letters (a-z, A-Z) and apostrophe (')
      if (/^[a-zA-Z']$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
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
    setCurrentPage(0);
    setSelectedIndex(0);
  }, []);

  return {
    script,
    setScript,
    toggleScript,
    committedText,
    setCommittedText,
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
    clearAll,
  };
}

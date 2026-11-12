import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  LazyPinyinSearchEngine,
  loadDictionary,
  type DownloadProgress,
  type SearchResult,
  type ScriptType,
} from '@pinyinduck/core';
import { DICTIONARY_URL } from '../dictionary-asset';

export type DictionaryStatus = 'loading' | 'ready' | 'error';

export interface UsePinyinDuckOptions {
  pageSize?: number;
  initialScript?: ScriptType;
  dictionaryUrl?: string;
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

/** " 42%" of the download, or " 1.2 MB" when the server did not say how big it is. */
function describeProgress(progress: DownloadProgress): string {
  if (progress.total) {
    return ` ${Math.min(100, Math.floor((progress.loaded / progress.total) * 100))}%`;
  }
  return ` ${(progress.loaded / 1_000_000).toFixed(1)} MB`;
}

const EMPTY_RESULT: SearchResult = { query: '', segments: [], candidates: [], total: 0 };

/** Candidates fetched per query; the popup pages through them a screen at a time. */
const CANDIDATE_LIMIT = 50;

export function usePinyinDuck(options: UsePinyinDuckOptions = {}) {
  const { pageSize = 5, initialScript = 'simplified', dictionaryUrl = DICTIONARY_URL } = options;

  const [engine, setEngine] = useState<LazyPinyinSearchEngine | null>(null);
  const [dictionaryStatus, setDictionaryStatus] = useState<DictionaryStatus>('loading');
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  // The label rather than the byte counts, so the hundreds of chunks a download arrives in
  // re-render only when the percentage or tenth of a megabyte on screen changes.
  const [downloadProgress, setDownloadProgress] = useState('');
  const [entryCount, setEntryCount] = useState(0);
  const [script, setScriptState] = useState<ScriptType>(initialScript);
  const [committedText, setCommittedText] = useState<string>('');
  const [compositionBuffer, setCompositionBuffer] = useState<string>('');
  const [insertPos, setInsertPos] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Target cursor position to restore on next render
  const cursorToRestoreRef = useRef<number | null>(null);

  /** Replaces the committed text and puts the caret at `caret`. */
  const setText = useCallback((text: string, caret: number, restoreCaret = true) => {
    setCommittedText(text);
    setInsertPos(caret);
    if (restoreCaret) cursorToRestoreRef.current = caret;
  }, []);

  /** Sets the composition buffer and goes back to the first candidate on page one. */
  const setBuffer = useCallback((buffer: string) => {
    setCompositionBuffer(buffer);
    setCurrentPage(0);
    setSelectedIndex(0);
  }, []);

  // The whole dictionary is downloaded once, compressed, and searched in memory. The
  // download is a few megabytes, so its progress is shown. Typing works while it loads,
  // but nothing commits until it is ready.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setDictionaryStatus('loading');
    setDictionaryError(null);
    setDownloadProgress('');

    loadDictionary(dictionaryUrl, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!cancelled) setDownloadProgress(describeProgress(progress));
      },
    })
      .then((dictionary) => {
        if (cancelled) return;
        setEngine(new LazyPinyinSearchEngine(dictionary));
        setEntryCount(dictionary.entryCount);
        setDictionaryStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        setDictionaryError(err instanceof Error ? err.message : String(err));
        setDictionaryStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dictionaryUrl]);

  // The search is synchronous and takes a few milliseconds, so the candidate list is
  // derived while rendering and always belongs to the buffer on screen.
  const search = useMemo((): { result: SearchResult; error: string | null } => {
    if (!engine || !compositionBuffer) return { result: EMPTY_RESULT, error: null };
    try {
      const result = engine.search(compositionBuffer, { script, limit: CANDIDATE_LIMIT, offset: 0 });
      return { result, error: null };
    } catch (err) {
      // Only a corrupt page throws here: opening the asset already checked its header,
      // directory and page bounds. The query has no candidates, and the effect below
      // reports the broken asset rather than letting it pass for "no match".
      return { result: EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) };
    }
  }, [engine, compositionBuffer, script]);
  const searchResult = search.result;

  // A corrupt page means the asset is broken for good, so the failure sticks, as a
  // failed load does, and raw pinyin can still be committed.
  useEffect(() => {
    if (search.error === null) return;
    setDictionaryError(search.error);
    setDictionaryStatus('error');
  }, [search.error]);

  const allCandidates = searchResult.candidates;
  const totalCandidates = allCandidates.length;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / pageSize));

  // Get current page slice
  const pageCandidates = useMemo(() => {
    const start = currentPage * pageSize;
    return allCandidates.slice(start, start + pageSize);
  }, [allCandidates, currentPage, pageSize]);

  /** Inserts `text` into the committed text at the caret and moves the caret past it. */
  const insertCommitted = useCallback(
    (text: string) => {
      setText(
        committedText.slice(0, insertPos) + text + committedText.slice(insertPos),
        insertPos + text.length
      );
    },
    [committedText, insertPos, setText]
  );

  // Select a candidate by visible page index (0 to pageSize - 1).
  const selectCandidate = useCallback(
    (indexOnPage: number) => {
      const candidate = pageCandidates[indexOnPage];
      if (!candidate) return;
      insertCommitted(candidate.hanzi);
      // A partial match leaves the pinyin it did not consume to compose next; a full
      // match leaves nothing.
      setBuffer(candidate.remainingPinyin);
    },
    [pageCandidates, insertCommitted, setBuffer]
  );

  // Commit raw untranslated pinyin text
  const commitRaw = useCallback(() => {
    if (!compositionBuffer) return;
    insertCommitted(compositionBuffer);
    setBuffer('');
  }, [compositionBuffer, insertCommitted, setBuffer]);

  // Cancel composition
  const cancelComposition = useCallback(() => {
    setBuffer('');
  }, [setBuffer]);

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
      // True only while a load is genuinely in flight. A failed load is terminal,
      // so the user must still be able to commit the raw pinyin they typed.
      const isPending = dictionaryStatus === 'loading';
      const start = textarea?.selectionStart ?? insertPos;
      const end = textarea?.selectionEnd ?? insertPos;
      const hasSelection = start !== end;

      /** Replaces committed text `[from, to)` with `insert`, leaving the caret after it. */
      const replaceText = (from: number, to: number, insert: string, restoreCaret = true) =>
        setText(
          committedText.slice(0, from) + insert + committedText.slice(to),
          from + insert.length,
          restoreCaret
        );

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
          replaceText(start, end, '');
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

      // Backspace and Delete. While composing, Backspace edits the buffer and Delete is
      // left to the browser. Otherwise both remove the selection, or one character on
      // their side of the caret: a whole code point, so a surrogate pair goes at once.
      if (e.key === 'Backspace' || (e.key === 'Delete' && !isComposing)) {
        e.preventDefault();
        if (isComposing) {
          setBuffer(compositionBuffer.slice(0, -1));
        } else if (hasSelection) {
          replaceText(start, end, '');
        } else if (e.key === 'Backspace' && start > 0) {
          const width = start >= 2 && committedText.codePointAt(start - 2)! > 0xffff ? 2 : 1;
          replaceText(start - width, start, '');
        } else if (e.key === 'Delete' && start < committedText.length) {
          const width = committedText.codePointAt(start)! > 0xffff ? 2 : 1;
          replaceText(start, start + width, '');
        }
        return;
      }

      // Handle Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isComposing) {
          // While the dictionary is still loading, committing raw pinyin would
          // silently discard the candidate the user expects in a moment. Once the
          // load has failed there is nothing to wait for, so raw text is inserted.
          if (!isPending) commitRaw();
        } else {
          replaceText(start, end, '\n');
        }
        return;
      }

      // Handle Space
      if (e.key === ' ') {
        e.preventDefault();
        if (isComposing) {
          if (isPending) return;
          // Commit the highlighted candidate, or the pinyin as typed when nothing matched.
          if (allCandidates.length === 0) commitRaw();
          else selectCandidate(selectedIndex);
        } else {
          replaceText(start, end, ' ');
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
        // Out of range: swallowed, and the composition is left exactly as it was.
        if (digit >= 1 && digit <= pageCandidates.length) selectCandidate(digit - 1);
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
          if (isPending) return;
          // The highlighted candidate, or the pinyin as typed, followed by the punctuation.
          const chosen = pageCandidates[selectedIndex]?.hanzi ?? compositionBuffer;
          insertCommitted(chosen + mappedPunct);
          setBuffer('');
        } else {
          replaceText(start, end, mappedPunct);
        }
        return;
      }

      // Handle alphabetic letters (a-z, A-Z) and apostrophe (') -> Pinyin Composition
      if (/^[a-zA-Z']$/.test(e.key)) {
        e.preventDefault();
        if (!isComposing) {
          // Starting a composition replaces any selection. This path has never restored
          // the caret, unlike every other edit; kept as-is so behaviour does not change.
          if (hasSelection) replaceText(start, end, '', false);
          else setInsertPos(start);
        }
        setBuffer(compositionBuffer + e.key.toLowerCase());
        return;
      }
    },
    [
      compositionBuffer,
      dictionaryStatus,
      allCandidates.length,
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
      insertCommitted,
      setText,
      setBuffer,
    ]
  );

  // A script change rebuilds the candidate list, and the two scripts can have different
  // numbers of candidates, so the page and highlight go back to the first candidate.
  const setScript = useCallback((next: ScriptType) => {
    setScriptState(next);
    setCurrentPage(0);
    setSelectedIndex(0);
  }, []);

  const toggleScript = useCallback(() => {
    setScript(script === 'simplified' ? 'traditional' : 'simplified');
  }, [script, setScript]);

  const clearAll = useCallback(() => {
    setText('', 0);
    setBuffer('');
  }, [setText, setBuffer]);

  return {
    script,
    setScript,
    toggleScript,
    dictionaryStatus,
    dictionaryError,
    downloadProgress,
    entryCount,
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
    cursorToRestoreRef,
    clearAll,
  };
}

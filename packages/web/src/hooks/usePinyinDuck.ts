import { useState, useMemo, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import {
  LazyPinyinSearchEngine,
  candidateDetail,
  type Candidate,
  type DetailView,
  loadDictionary,
  loadBigramTable,
  type BigramTable,
  type BTreeDictionary,
  type DownloadProgress,
  type SearchResult,
  type ScriptType,
} from '@pinyinduck/core';
import { DICTIONARY_URL } from '../dictionary-asset';
import { DETAIL_URL } from '../detail-asset';
import { BIGRAMS_URL } from '../bigram-asset';
import { createDetailLoader, type DetailLoadState } from '../detail/detail-loader';

export type DictionaryStatus = 'loading' | 'ready' | 'error';

/**
 * Where the bigram table is: not configured, waiting for the dictionary or downloading,
 * loaded, or failed (search then scores Sentence candidates unigram only).
 */
export type BigramStatus = 'none' | 'loading' | 'ready' | 'failed';

export interface UsePinyinDuckOptions {
  pageSize?: number;
  initialScript?: ScriptType;
  dictionaryUrl?: string;
  detailUrl?: string;
  /** The bigram table Sentence candidates score with; none means unigram only. */
  bigramsUrl?: string | null;
}

/**
 * The open Candidate detail: the highlighted candidate, and its detail view once the detail
 * file is in. Until then `status` says whether it is on its way or failed to load.
 */
export interface OpenCandidateDetail {
  candidate: Candidate;
  /** The candidate's index on the current page. */
  index: number;
  status: 'loading' | 'ready' | 'failed';
  view?: DetailView;
  /** For a Sentence candidate, once ready: one detail view per word, in order. */
  wordViews?: DetailView[];
}

const IDLE: DetailLoadState = { status: 'idle' };
const NO_SUBSCRIPTION = () => () => {};

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
  const {
    pageSize = 5,
    initialScript = 'simplified',
    dictionaryUrl = DICTIONARY_URL,
    detailUrl = DETAIL_URL,
    bigramsUrl = BIGRAMS_URL ?? null,
  } = options;

  const [dictionary, setDictionary] = useState<BTreeDictionary | null>(null);
  const [bigrams, setBigrams] = useState<BigramTable | null>(null);
  const [bigramFailed, setBigramFailed] = useState(false);
  const [dictionaryStatus, setDictionaryStatus] = useState<DictionaryStatus>('loading');
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  // The label rather than the byte counts, so the hundreds of chunks a download arrives in
  // re-render only when the percentage or tenth of a megabyte on screen changes.
  const [downloadProgress, setDownloadProgress] = useState('');
  const [script, setScriptState] = useState<ScriptType>(initialScript);
  const [committedText, setCommittedText] = useState<string>('');
  const [compositionBuffer, setCompositionBuffer] = useState<string>('');
  const [insertPos, setInsertPos] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [detailRequested, setDetailRequested] = useState(false);

  // Target cursor position to restore on next render
  const cursorToRestoreRef = useRef<number | null>(null);

  /** Replaces the committed text and puts the caret at `caret`. */
  const setText = useCallback((text: string, caret: number) => {
    setCommittedText(text);
    setInsertPos(caret);
    cursorToRestoreRef.current = caret;
  }, []);

  /** Sets the composition buffer and goes back to the first candidate on page one. */
  const setBuffer = useCallback((buffer: string) => {
    setCompositionBuffer(buffer);
    // The detail belongs to a composition: it stays open while the user types on, and
    // goes when the composition ends.
    if (buffer === '') setDetailRequested(false);
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
        setDictionary(dictionary);
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

  // The bigram table loads after the dictionary, so it never delays the first candidates.
  // Until it arrives, and for good if it fails, Sentence candidates score unigram only.
  useEffect(() => {
    if (!dictionary || !bigramsUrl) return;
    const controller = new AbortController();
    let cancelled = false;
    loadBigramTable(bigramsUrl, { signal: controller.signal })
      .then((table) => {
        if (!cancelled) setBigrams(table);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        setBigramFailed(true);
        console.warn(`Sentence candidates will score without bigrams: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dictionary, bigramsUrl]);

  const bigramStatus: BigramStatus = !bigramsUrl
    ? 'none'
    : bigrams
      ? 'ready'
      : bigramFailed
        ? 'failed'
        : 'loading';

  const engine = useMemo(
    () => (dictionary ? new LazyPinyinSearchEngine(dictionary, bigrams ? { bigrams } : {}) : null),
    [dictionary, bigrams]
  );
  const entryCount = dictionary?.entryCount ?? 0;

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

  // One loader per dictionary, because the detail file must come from the same build. It
  // fetches nothing until the first Candidate detail opens.
  const detailLoader = useMemo(
    () => (dictionary ? createDetailLoader({ url: detailUrl, buildId: dictionary.buildId }) : null),
    [dictionary, detailUrl]
  );
  const detailLoad = useSyncExternalStore(
    detailLoader?.subscribe ?? NO_SUBSCRIPTION,
    () => detailLoader?.state ?? IDLE
  );

  // Open only while there is a highlighted candidate to show, so a query with no match
  // hides the detail rather than leaving an invisible one for Esc to close.
  const detailCandidate = detailRequested ? pageCandidates[selectedIndex] : undefined;
  const detail = useMemo((): OpenCandidateDetail | null => {
    if (!detailCandidate) return null;
    const base = { candidate: detailCandidate, index: selectedIndex };
    if (detailLoad.status === 'ready') {
      try {
        // A Sentence candidate stands for no entry of its own: each word has its view.
        if (detailCandidate.words) {
          const wordViews = detailCandidate.words.map((word) => candidateDetail(word, script, detailLoad.file));
          return { ...base, status: 'ready', wordViews };
        }
        return { ...base, status: 'ready', view: candidateDetail(detailCandidate, script, detailLoad.file) };
      } catch {
        // An entry id the file does not hold: the file is broken, which reads as a failed load.
        return { ...base, status: 'failed' };
      }
    }
    return { ...base, status: detailLoad.status === 'failed' ? 'failed' : 'loading' };
  }, [detailCandidate, selectedIndex, detailLoad, script]);
  const detailOpen = detail !== null;

  /**
   * Opens or closes the detail. Given a row, opens that row's detail instead, unless it is
   * already the one open. Every opening asks for the detail file, so after a failed load the
   * next open tries again; moving the highlight while it is open does not.
   */
  const toggleDetail = useCallback(
    (indexOnPage: number = selectedIndex) => {
      if (!pageCandidates[indexOnPage]) return;
      const closing = detailOpen && indexOnPage === selectedIndex;
      setSelectedIndex(indexOnPage);
      setDetailRequested(!closing);
      if (!closing) detailLoader?.request();
    },
    [selectedIndex, pageCandidates, detailOpen, detailLoader]
  );

  const closeDetail = useCallback(() => setDetailRequested(false), []);

  /** Replaces committed text `[from, to)` with `insert`, leaving the caret after it. */
  const replaceText = useCallback(
    (from: number, to: number, insert: string) =>
      setText(committedText.slice(0, from) + insert + committedText.slice(to), from + insert.length),
    [committedText, setText]
  );

  /** Inserts `text` into the committed text at the caret and moves the caret past it. */
  const insertCommitted = useCallback(
    (text: string) => replaceText(insertPos, insertPos, text),
    [insertPos, replaceText]
  );

  // Select a candidate by visible page index (0 to pageSize - 1).
  const selectCandidate = useCallback(
    (indexOnPage: number) => {
      const candidate = pageCandidates[indexOnPage];
      if (!candidate) return;
      insertCommitted(candidate.hanzi);
      // Committing closes the detail, even when pinyin is left over to compose next.
      setDetailRequested(false);
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

      // Handle Escape: close the Candidate detail first, then cancel composition
      if (e.key === 'Escape') {
        if (isComposing) {
          e.preventDefault();
          if (detailOpen) closeDetail();
          else cancelComposition();
        }
        return;
      }

      // Tab toggles the Candidate detail of the highlighted candidate. While composing it
      // never moves focus out of the editor, even when there is nothing to show.
      if (e.key === 'Tab') {
        if (isComposing) {
          e.preventDefault();
          toggleDetail();
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
          // Starting a composition replaces any selection, so the commit lands where it was.
          if (hasSelection) replaceText(start, end, '');
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
      detailOpen,
      closeDetail,
      toggleDetail,
      nextPage,
      prevPage,
      moveSelection,
      insertCommitted,
      replaceText,
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
    bigramStatus,
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
    detail,
    toggleDetail,
    nextPage,
    prevPage,
    handleKeyDown,
    handleTextareaChange,
    cursorToRestoreRef,
    clearAll,
  };
}

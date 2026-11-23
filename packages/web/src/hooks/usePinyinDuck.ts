import { useState, useMemo, useCallback, useRef, useEffect, useSyncExternalStore, type SetStateAction } from 'react';
import {
  LazyPinyinSearchEngine,
  candidateDetail,
  type Candidate,
  type DetailView,
  type FixedWord,
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
import { carryFixedWords, composingAfter } from '../sentence/fixed-words';

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

/**
 * The open word menu (#37): one word of the highlighted Sentence candidate, the alternatives
 * it can be swapped for, numbered from 1, and then "Commit through" that word.
 */
export interface OpenWordMenu {
  /** The Sentence candidate's index on the current page. */
  index: number;
  /** Which of its words the menu is for. */
  wordIndex: number;
  word: Candidate;
  alternatives: Candidate[];
}

/** What the popup needs to draw word menus and act on them. */
export interface WordMenuControls {
  menu: OpenWordMenu | null;
  /** The Fixed words, so their blocks can be marked. */
  fixedWords: readonly FixedWord[];
  /** Opens word `wordIndex` of row `index`'s menu, or closes it if open. */
  toggle: (index: number, wordIndex: number) => void;
  /** Swaps the menu's word for its alternative `n`, from 0. */
  swap: (n: number) => void;
  commitThrough: () => void;
}

/** Alternatives a word menu offers, one per digit key. */
const MENU_ALTERNATIVES = 9;

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
  // The Fixed words the learner has chosen in the Sentence candidate being composed. The
  // engine is stateless, so they are passed on every search.
  const [fixedWords, setFixedWords] = useState<FixedWord[]>([]);
  // The word of the highlighted Sentence candidate whose menu is open, or null.
  const [menuWord, setMenuWord] = useState<number | null>(null);

  // Target cursor position to restore on next render
  const cursorToRestoreRef = useRef<number | null>(null);

  /** Replaces the committed text and puts the caret at `caret`. */
  const setText = useCallback((text: string, caret: number) => {
    setCommittedText(text);
    setInsertPos(caret);
    cursorToRestoreRef.current = caret;
  }, []);

  /**
   * Moves the highlight to row `index` of page `page`. The word menu belongs to the row and
   * the sentence it was opened on, so every move closes it, even one that stays put: this is
   * the one place it closes, apart from Esc.
   */
  const moveHighlight = useCallback((page: SetStateAction<number>, index: number) => {
    setCurrentPage(page);
    setSelectedIndex(index);
    setMenuWord(null);
  }, []);

  /**
   * Sets the composition buffer and goes back to the first candidate on page one. The Fixed
   * words last while the learner types on, less any a Backspace reached into; the word menu
   * belongs to the sentence as it was, so it closes.
   */
  const setBuffer = useCallback(
    (buffer: string) => {
      setCompositionBuffer(buffer);
      setFixedWords((fixed) => carryFixedWords(fixed, buffer));
      // The detail belongs to a composition: it stays open while the user types on, and
      // goes when the composition ends.
      if (buffer === '') setDetailRequested(false);
      moveHighlight(0, 0);
    },
    [moveHighlight]
  );

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
      const result = engine.search(compositionBuffer, { script, limit: CANDIDATE_LIMIT, offset: 0, fixedWords });
      return { result, error: null };
    } catch (err) {
      // Only a corrupt page throws here: opening the asset already checked its header,
      // directory and page bounds. The query has no candidates, and the effect below
      // reports the broken asset rather than letting it pass for "no match".
      return { result: EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) };
    }
  }, [engine, compositionBuffer, script, fixedWords]);
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
      moveHighlight((page) => page, indexOnPage);
      setDetailRequested(!closing);
      if (!closing) detailLoader?.request();
    },
    [selectedIndex, pageCandidates, detailOpen, detailLoader, moveHighlight]
  );

  const closeDetail = useCallback(() => setDetailRequested(false), []);

  // The menu is only ever for a word of the highlighted candidate, and only while that is a
  // Sentence candidate. The faded "next" leftover is not a word, so it has none.
  const menuCandidate = menuWord !== null ? pageCandidates[selectedIndex] : undefined;
  const wordMenu = useMemo((): OpenWordMenu | null => {
    const word = menuWord !== null ? menuCandidate?.words?.[menuWord] : undefined;
    if (!engine || !word?.span) return null;
    const alternatives = engine
      .alternativesForSpan(compositionBuffer, word.span, { script })
      .slice(0, MENU_ALTERNATIVES);
    return { index: selectedIndex, wordIndex: menuWord!, word, alternatives };
  }, [engine, menuCandidate, menuWord, selectedIndex, compositionBuffer, script]);

  /**
   * Moves the word cursor one block along the highlighted Sentence candidate, opening that
   * block's menu. From closed it starts at the end it moves from; past either end it closes.
   * Returns false when the highlighted candidate is not a sentence.
   */
  const moveWordCursor = useCallback(
    (direction: 'next' | 'prev'): boolean => {
      const words = pageCandidates[selectedIndex]?.words;
      if (!words) return false;
      const step = direction === 'next' ? 1 : -1;
      const next = menuWord === null ? (direction === 'next' ? 0 : words.length - 1) : menuWord + step;
      setMenuWord(next >= 0 && next < words.length ? next : null);
      setDetailRequested(false);
      return true;
    },
    [pageCandidates, selectedIndex, menuWord]
  );

  /** Opens the menu of word `wordIndex` of row `indexOnPage`, or closes it if it is open. */
  const toggleWordMenu = useCallback(
    (indexOnPage: number, wordIndex: number) => {
      if (!pageCandidates[indexOnPage]?.words?.[wordIndex]) return;
      const closing = wordMenu?.index === indexOnPage && wordMenu.wordIndex === wordIndex;
      setSelectedIndex(indexOnPage);
      setMenuWord(closing ? null : wordIndex);
      setDetailRequested(false);
    },
    [pageCandidates, wordMenu]
  );

  const closeWordMenu = useCallback(() => setMenuWord(null), []);

  /**
   * Swaps the menu's word for alternative `n` (from 0): it becomes a Fixed word on its span,
   * in place of any fixed on that span, and the sentence is rebuilt around it. The edited
   * sentence comes first, so the highlight goes back to it.
   */
  const swapWord = useCallback(
    (n: number) => {
      const alt = wordMenu?.alternatives[n];
      if (!alt?.span) return;
      const span = alt.span;
      const word = { simplified: alt.simplified, traditional: alt.traditional, pinyinNumbers: alt.pinyinNumbers };
      setFixedWords((fixed) => [
        ...fixed.filter((f) => f.span.end <= span.start || f.span.start >= span.end),
        { span, word },
      ]);
      moveHighlight(0, 0);
    },
    [wordMenu, moveHighlight]
  );

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

  /**
   * Ends what is being composed, leaving `buffer` to compose next. Every commit and a cancel
   * go through here, and drop every Fixed word: they belonged to the sentence just ended.
   */
  const composeAfresh = useCallback(
    (buffer: string) => {
      setBuffer(buffer);
      setFixedWords([]);
    },
    [setBuffer]
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
      composeAfresh(candidate.remainingPinyin);
    },
    [pageCandidates, insertCommitted, composeAfresh]
  );

  /**
   * Commits the highlighted Sentence candidate up to and including the menu's word. The rest
   * of what was typed stays composing and is searched again, like the leftover of a prefix word.
   */
  const commitThrough = useCallback(() => {
    const words = wordMenu ? pageCandidates[wordMenu.index]?.words : undefined;
    if (!wordMenu || !words || !wordMenu.word.span) return;
    insertCommitted(words.slice(0, wordMenu.wordIndex + 1).map((w) => w.hanzi).join(''));
    setDetailRequested(false);
    composeAfresh(composingAfter(compositionBuffer, wordMenu.word.span.end));
  }, [wordMenu, pageCandidates, insertCommitted, compositionBuffer, composeAfresh]);

  // Commit raw untranslated pinyin text
  const commitRaw = useCallback(() => {
    if (!compositionBuffer) return;
    insertCommitted(compositionBuffer);
    composeAfresh('');
  }, [compositionBuffer, insertCommitted, composeAfresh]);

  // Cancel composition
  const cancelComposition = useCallback(() => {
    composeAfresh('');
  }, [composeAfresh]);

  // Navigation
  const nextPage = useCallback(
    () => moveHighlight((prev) => (prev + 1 < totalPages ? prev + 1 : prev), 0),
    [totalPages, moveHighlight]
  );

  const prevPage = useCallback(() => moveHighlight((prev) => (prev > 0 ? prev - 1 : 0), 0), [moveHighlight]);

  const moveSelection = useCallback(
    (direction: 'next' | 'prev') => {
      if (pageCandidates.length === 0) return;
      let page = currentPage;
      let index = selectedIndex;
      if (direction === 'next') {
        if (index + 1 < pageCandidates.length) {
          index++;
        } else if (page + 1 < totalPages) {
          page++;
          index = 0;
        }
      } else {
        if (index > 0) {
          index--;
        } else if (page > 0) {
          page--;
          index = pageSize - 1;
        }
      }
      moveHighlight(page, index);
    },
    [pageCandidates.length, selectedIndex, currentPage, totalPages, pageSize, moveHighlight]
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

      // Handle Escape: close the word menu or Candidate detail first, then cancel composition
      if (e.key === 'Escape') {
        if (isComposing) {
          e.preventDefault();
          if (wordMenu) closeWordMenu();
          else if (detailOpen) closeDetail();
          else cancelComposition();
        }
        return;
      }

      // Shift+←/→ moves the word cursor across the highlighted Sentence candidate's blocks.
      if (isComposing && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (moveWordCursor(e.key === 'ArrowRight' ? 'next' : 'prev')) {
          e.preventDefault();
          return;
        }
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
        if (isComposing && wordMenu) {
          commitThrough();
        } else if (isComposing) {
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
        // Out of range: swallowed, and the composition is left exactly as it was. With the
        // word menu open a digit picks an alternative for its word instead.
        if (wordMenu) {
          if (digit >= 1 && digit <= wordMenu.alternatives.length) swapWord(digit - 1);
        } else if (digit >= 1 && digit <= pageCandidates.length) selectCandidate(digit - 1);
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
          composeAfresh('');
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
      composeAfresh,
      wordMenu,
      closeWordMenu,
      moveWordCursor,
      commitThrough,
      swapWord,
    ]
  );

  // A script change rebuilds the candidate list, and the two scripts can have different
  // numbers of candidates, so the page and highlight go back to the first candidate.
  const setScript = useCallback(
    (next: ScriptType) => {
      setScriptState(next);
      moveHighlight(0, 0);
    },
    [moveHighlight]
  );

  const toggleScript = useCallback(() => {
    setScript(script === 'simplified' ? 'traditional' : 'simplified');
  }, [script, setScript]);

  const clearAll = useCallback(() => {
    setText('', 0);
    composeAfresh('');
  }, [setText, composeAfresh]);

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
    wordMenu: { menu: wordMenu, fixedWords, toggle: toggleWordMenu, swap: swapWord, commitThrough } satisfies WordMenuControls,
    nextPage,
    prevPage,
    handleKeyDown,
    handleTextareaChange,
    cursorToRestoreRef,
    clearAll,
  };
}

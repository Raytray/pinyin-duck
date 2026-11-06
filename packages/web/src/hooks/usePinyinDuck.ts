import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  DictionaryChangedError,
  LazyPinyinSearchEngine,
  openBTreeDictionary,
  DEFAULT_BTREE_URL,
  type Candidate,
  type SearchResult,
  type ScriptType,
} from '@pinyinduck/core';

export type DictionaryStatus = 'loading' | 'ready' | 'error';

/**
 * Whether the candidate list reflects the current composition buffer.
 *
 * Searching is now async, because each query reads dictionary pages on demand. There is
 * a window between a keystroke and its results where the previous query's candidates are
 * still on screen; the UI uses this to avoid offering a stale pick.
 */
export type SearchStatus = 'idle' | 'searching' | 'ready';

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

const EMPTY_RESULT: SearchResult = { query: '', segments: [], candidates: [], total: 0 };

/** Candidates fetched per query; the popup pages through them a screen at a time. */
const CANDIDATE_LIMIT = 50;

export function usePinyinDuck(options: UsePinyinDuckOptions = {}) {
  const { pageSize = 5, initialScript = 'simplified', dictionaryUrl = DEFAULT_BTREE_URL } = options;

  const [engine, setEngine] = useState<LazyPinyinSearchEngine | null>(null);
  const [dictionaryStatus, setDictionaryStatus] = useState<DictionaryStatus>('loading');
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  const [entryCount, setEntryCount] = useState(0);
  const [script, setScript] = useState<ScriptType>(initialScript);
  const [committedText, setCommittedText] = useState<string>('');
  const [compositionBuffer, setCompositionBuffer] = useState<string>('');
  const [insertPos, setInsertPosState] = useState<number>(0);

  // A commit resolves after a lazy read, so the caret position it inserts at has to be
  // read from here: the closure a handler was created in can predate the previous
  // commit and would splice the text at a stale offset.
  const insertPosRef = useRef(0);
  const setInsertPos = useCallback((pos: number) => {
    insertPosRef.current = pos;
    setInsertPosState(pos);
  }, []);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [searchResult, setSearchResult] = useState<SearchResult>(EMPTY_RESULT);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');

  // Target cursor position to restore on next render
  const cursorToRestoreRef = useRef<number | null>(null);

  // Monotonic id for in-flight searches. Only the newest search may commit its
  // result, so a slow query for an earlier keystroke cannot overwrite a newer answer.
  const searchRequestRef = useRef<number>(0);

  // The composition buffer, the active engine and the active script as of the last
  // key event, plus the in-flight search and the newest result it produced. Commit
  // actions read these rather than the rendered state, which can still be a keystroke
  // behind when a key is handled before React has re-rendered.
  const bufferRef = useRef('');
  const engineRef = useRef<LazyPinyinSearchEngine | null>(null);
  const scriptRef = useRef<ScriptType>(initialScript);
  const searchRunRef = useRef<{ key: string; promise: Promise<SearchResult> } | null>(null);
  const searchResultRef = useRef<{ script: ScriptType; result: SearchResult } | null>(null);

  // A commit resolves after the search, by which time the closure it was created in
  // can be a keystroke out of date. The text is read from here instead so two commits
  // landing in quick succession build on each other rather than overwriting.
  const committedTextRef = useRef('');

  // The live textarea, captured from the key handler, used to read the caret a commit
  // should follow.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // True between the app writing text into the controlled textarea and React rendering
  // it. Commits resolve along a promise chain, so two of them can land inside one tick,
  // before any render. The textarea still holds the pre-commit value then, and reading it
  // as the text to splice into rolls the first commit back and pushes the second past
  // the end of the text.
  const domRenderPendingRef = useRef(false);

  // Incremented by every pick key. A digit that resolves to "out of range" leaves the
  // composition alone, so a second digit pressed before the first resolved would
  // otherwise act twice on the same list.
  const pickTokenRef = useRef(0);

  // Commits finish after a lazy read, so they run in key order rather than in whatever
  // order those reads happen to settle: committing "nihao" and then "xiexie" has to
  // produce 你好谢谢, never the two in the other order.
  const commitQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const commitPendingRef = useRef(0);

  // Where each queued commit was requested, and how many characters it added once it
  // landed. A commit captures the caret position when its key is pressed, but a commit
  // queued ahead of it has landed since and pushed that position along; because the
  // queue is ordered, what those commits claimed is exactly that shift.
  //
  // Entries are keyed by position rather than summed into one running total, because a
  // commit only shifts what lands after it: one requested at a later offset than this
  // commit inserts to its right and leaves this one where it is.
  //
  // The list is cleared when the queue drains, not as each commit lands. A commit that
  // has landed still has to shift the offsets of the ones behind it, which are captured
  // in the text as it was when their keys were pressed.
  const queuedInsertsRef = useRef<{ at: number; length: number }[]>([]);

  const enqueueCommit = useCallback((task: () => Promise<void>, at: number) => {
    commitPendingRef.current++;
    queuedInsertsRef.current.push({ at, length: 0 });
    const next = commitQueueRef.current.then(task, task).finally(() => {
      commitPendingRef.current--;
      if (commitPendingRef.current === 0) queuedInsertsRef.current = [];
    });
    // Tasks handle their own failures; the chain only has to stay alive.
    commitQueueRef.current = next.catch(() => {});
    return next;
  }, []);

  const setCommitted = useCallback((text: string) => {
    committedTextRef.current = text;
    domRenderPendingRef.current = true;
    setCommittedText(text);
  }, []);

  // The textarea holds the app's own text again once React has rendered it, so a value
  // that differs from the mirrored state is the user's input rather than a commit that
  // has already been made.
  useEffect(() => {
    domRenderPendingRef.current = false;
  }, [committedText]);

  // Mirror the script so a key event always sees the current one.
  useEffect(() => {
    scriptRef.current = script;
  }, [script]);

  // The dictionary is a multi-megabyte B-tree asset. Opening it reads only the header
  // and the page directory, so the app becomes usable almost immediately and the
  // remaining pages stream in as queries need them. Typing works while it loads.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setDictionaryStatus('loading');
    setDictionaryError(null);

    openBTreeDictionary(dictionaryUrl, { signal: controller.signal })
      .then((dictionary) => {
        if (cancelled) return;
        const opened = new LazyPinyinSearchEngine(dictionary);
        engineRef.current = opened;
        setEngine(opened);
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

  /**
   * Runs the dictionary search for a query, sharing one promise per (script, query).
   *
   * Both the rendering effect and the commit actions go through here, so a Space or
   * digit pressed while the effect for the latest keystroke has not run yet still
   * waits for the right search instead of the previous query's.
   */
  const runSearch = useCallback(
    (query: string, forScript: ScriptType): Promise<SearchResult> => {
      const key = `${forScript}::${query}`;
      const running = searchRunRef.current;
      if (running && running.key === key) return running.promise;

      const current = engineRef.current;
      if (!current || !query) return Promise.resolve(EMPTY_RESULT);

      const promise = current
        .search(query, { script: forScript, limit: CANDIDATE_LIMIT, offset: 0 })
        .catch((err: unknown) => {
          // A failed page read is not recoverable mid-session; the open effect
          // already reports a bad asset, so treat the query as having no matches.
          // A rebuilt asset is the exception the open effect cannot see: say so, or
          // every later query would silently come back empty.
          if (err instanceof DictionaryChangedError) {
            setDictionaryError(err.message);
            setDictionaryStatus('error');
          }
          return EMPTY_RESULT;
        });
      searchRunRef.current = { key, promise };
      return promise;
    },
    []
  );

  // Search candidates whenever composition buffer or script changes. The engine reads
  // dictionary pages as it goes, so the result is only committed if this search is
  // still the newest one when it finishes.
  useEffect(() => {
    if (!engine || !compositionBuffer) {
      // Invalidate any in-flight search so a slow page read cannot resurrect its
      // candidates after the buffer has already been cleared.
      searchRequestRef.current++;
      searchRunRef.current = null;
      searchResultRef.current = null;
      setSearchResult(EMPTY_RESULT);
      setSearchStatus('idle');
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchStatus('searching');

    runSearch(compositionBuffer, script).then((result) => {
      if (requestId !== searchRequestRef.current) return;
      searchResultRef.current = { script, result };
      setSearchResult(result);
      setSearchStatus('ready');
    });
  }, [engine, compositionBuffer, script, runSearch]);

  /**
   * The candidate list for the buffer as it stands, if it is already on screen.
   *
   * The lazy engine resolves a query from the page cache most of the time, so this
   * fast path keeps a commit synchronous. That matters more than it looks: the editor
   * is a controlled textarea, and a commit that lands a tick after the next keypress
   * splices text at a position the DOM has already moved past. Only a query whose
   * result has not arrived yet has to fall back to the queued async path.
   *
   * Returns null when the displayed list belongs to a different query or script.
   */
  const displayedCandidates = useCallback((): Candidate[] | null => {
    const shown = searchResultRef.current;
    if (!shown || !bufferRef.current) return null;
    if (shown.script !== scriptRef.current) return null;
    if (shown.result.query !== bufferRef.current) return null;
    return shown.result.candidates;
  }, []);

  const currentCandidates = useCallback(async (): Promise<Candidate[]> => {
    const shown = displayedCandidates();
    if (shown) return shown;
    const query = bufferRef.current;
    if (!engineRef.current || !query) return [];
    return (await runSearch(query, scriptRef.current)).candidates;
  }, [displayedCandidates, runSearch]);

  const allCandidates = searchResult.candidates;
  const totalCandidates = allCandidates.length;
  const totalPages = Math.max(1, Math.ceil(totalCandidates / pageSize));

  // Get current page slice
  const pageCandidates = useMemo(() => {
    const start = currentPage * pageSize;
    return allCandidates.slice(start, start + pageSize);
  }, [allCandidates, currentPage, pageSize]);

  /**
   * Inserts `text` into the committed text at `at`.
   *
   * The offset is captured when a commit is *requested*, not when it lands. A commit
   * waits for a dictionary page, and the user can type during that wait; splicing at
   * the offset the caret had when the key was pressed puts the committed character
   * before whatever they typed since, instead of at a caret the DOM has moved on from.
   */
  const insertCommitted = useCallback(
    (text: string, at: number) => {
      // Commits queued ahead of this one have not landed yet but have already claimed
      // their space. Only those landing at or before this offset push it along; one
      // landing further right does not.
      const shift = queuedInsertsRef.current.reduce(
        (total, queued) => (queued.at <= at ? total + queued.length : total),
        0
      );
      const position = at + shift;

      // The DOM wins over the mirrored state only when it holds text the app has not
      // seen yet: the user typed or pasted during the wait and React's state for it
      // may not have been applied. A value the app has itself just pushed is the other
      // way round -- it is a commit behind -- and splicing that in would drop the commit
      // and land this one past the end of the text.
      const dom = textareaRef.current;
      const domAhead =
        dom !== null && !domRenderPendingRef.current && dom.value !== committedTextRef.current;
      const current = domAhead ? dom.value : committedTextRef.current;
      // The caret the same way: the DOM's is only current while it is not a render
      // behind. A commit that landed earlier in this tick has already moved the caret,
      // and the textarea still holds the one before it, which would read as the user
      // having moved the caret back over the character just committed.
      const caretOffset =
        dom !== null && !domRenderPendingRef.current
          ? (dom.selectionStart ?? current.length)
          : insertPosRef.current;
      if (domAhead) {
        setCommitted(dom.value);
      }

      const before = current.slice(0, position);
      const after = current.slice(position);
      const newCommitted = before + text + after;

      // Follow the caret the user actually has, not the one this commit would choose.
      //
      // A caret at or after the insertion point moves with the text in front of it, so
      // that a commit landing mid-word does not leave the caret stranded before its own
      // output. A caret *before* the insertion point is left alone: the user moved it
      // there deliberately while the commit was in flight, and dragging it forward would
      // override them -- and the next character would then land in the wrong place.
      const caret = caretOffset >= position ? caretOffset + text.length : caretOffset;

      // Record what this commit claimed, so a commit queued behind it can see how far its
      // own offset moves. Commits land in the order they were queued, so the entry still
      // waiting on a length is this one. A commit that was not queued -- the synchronous
      // fast path -- has no entry, and by the time it returns there is nothing behind it
      // in the queue to shift.
      const claim = queuedInsertsRef.current.find((queued) => queued.length === 0);
      if (claim) claim.length = text.length;

      setCommitted(newCommitted);
      setInsertPos(caret);
      cursorToRestoreRef.current = caret;
      return newCommitted.length;
    },
    [setCommitted, setInsertPos]
  );

  /**
   * Commits the candidate at a position on the visible page, given its list.
   *
   * Taking the list as an argument is what lets the key handlers consume the
   * composition synchronously and finish the commit once the search resolves, instead
   * of leaving the buffer live until an async read comes back.
   */
  /**
   * Commits the candidate at a position on the visible page, given its list.
   *
   * `expectedBuffer` is what the composition buffer held when the commit was requested.
   * The commit lands a tick later, by which time a newer composition may have started;
   * when it has, this commit still inserts its character but leaves that buffer alone.
   */
  const commitCandidateFrom = useCallback(
    (candidates: Candidate[], indexOnPage: number, at: number, expectedBuffer: string) => {
      const start = currentPage * pageSize;
      const candidate = candidates.slice(start, start + pageSize)[indexOnPage];
      if (!candidate) return;

      insertCommitted(candidate.hanzi, at);
      if (bufferRef.current !== expectedBuffer) return;

      // If candidate had remaining pinyin (partial match), keep remaining in buffer
      if (candidate.remainingPinyin) {
        bufferRef.current = candidate.remainingPinyin;
        setCompositionBuffer(candidate.remainingPinyin);
        setCurrentPage(0);
        setSelectedIndex(0);
      } else {
        // Full consumption
        bufferRef.current = '';
        setCompositionBuffer('');
        setCurrentPage(0);
        setSelectedIndex(0);
      }
    },
    [currentPage, pageSize, insertCommitted]
  );

  // Select a candidate by visible page index (0 to pageSize - 1).
  // Async because a click or key can land while the search is still in flight; see
  // `currentCandidates`. Resolving to a promise is fine for both call sites.
  const selectCandidate = useCallback(
    async (indexOnPage: number) => {
      commitCandidateFrom(
        await currentCandidates(),
        indexOnPage,
        insertPosRef.current,
        bufferRef.current
      );
    },
    [currentCandidates, commitCandidateFrom]
  );

  /** Inserts the given pinyin as plain text and ends the composition. */
  const commitText = useCallback(
    (text: string, at: number, expectedBuffer: string) => {
      if (!text) return;
      insertCommitted(text, at);
      // As in `commitCandidateFrom`, a composition that started while this commit was
      // in flight keeps its buffer.
      if (bufferRef.current !== expectedBuffer) return;
      bufferRef.current = '';
      setCompositionBuffer('');
      setCurrentPage(0);
      setSelectedIndex(0);
    },
    [insertCommitted]
  );

  // Commit raw untranslated pinyin text
  const commitRaw = useCallback(() => {
    commitText(bufferRef.current, insertPosRef.current, bufferRef.current);
  }, [commitText]);

  // Cancel composition
  const cancelComposition = useCallback(() => {
    bufferRef.current = '';
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
        setCommitted(e.target.value);
        setInsertPos(e.target.selectionStart || 0);
      }
    },
    [compositionBuffer.length, setCommitted, setInsertPos]
  );

  // Keyboard handler for the editor
  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      textarea: HTMLTextAreaElement | null
    ) => {
      // Capture the element so a commit that resolves later can read the live value
      // and caret instead of a state snapshot that may be a keystroke behind.
      textareaRef.current = textarea;
      // Read composition state from the ref, not the rendered state: a key event can
      // be handled before React has re-rendered for the keystroke before it, and this
      // handler would then act on the previous buffer.
      const activeBuffer = bufferRef.current;
      const isComposing = activeBuffer.length > 0;
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
          const newText = committedText.slice(0, start) + committedText.slice(end);
          setCommitted(newText);
          cursorToRestoreRef.current = start;
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
          const nextBuffer = bufferRef.current.slice(0, -1);
          bufferRef.current = nextBuffer;
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
          setCommitted(newText);
          cursorToRestoreRef.current = start;
          setInsertPos(start);
        } else if (start > 0) {
          // Delete one character before cursor
          // Use Array.from to correctly handle UTF-16 surrogate pairs / emojis
          const beforeArr = Array.from(committedText.slice(0, start));
          const removed = beforeArr.pop() || '';
          const removeLen = removed.length;
          const newStart = start - removeLen;
          const newText = committedText.slice(0, newStart) + committedText.slice(start);
          setCommitted(newText);
          cursorToRestoreRef.current = newStart;
          setInsertPos(newStart);
        }
        return;
      }

      // Handle Delete (Forward delete):
      if (e.key === 'Delete' && !isComposing) {
        e.preventDefault();
        if (hasSelection) {
          const newText = committedText.slice(0, start) + committedText.slice(end);
          setCommitted(newText);
          cursorToRestoreRef.current = start;
          setInsertPos(start);
        } else if (start < committedText.length) {
          const afterArr = Array.from(committedText.slice(start));
          const removed = afterArr.shift() || '';
          const removeLen = removed.length;
          const newText = committedText.slice(0, start) + committedText.slice(start + removeLen);
          setCommitted(newText);
          cursorToRestoreRef.current = start;
          setInsertPos(start);
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
          // Insert newline in accepted text
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newText = before + '\n' + after;
          const newCursor = start + 1;
          setCommitted(newText);
          cursorToRestoreRef.current = newCursor;
          setInsertPos(newCursor);
        }
        return;
      }

      // Handle Space
      if (e.key === ' ') {
        e.preventDefault();
        if (isComposing) {
          if (isPending) return;
          // "Commit #1 if there is one, otherwise insert the pinyin as typed". Both
          // halves need the candidate list, which is a promise while the lazy engine
          // is still reading pages. So the composition is consumed here, now, and the
          // commit lands when the search resolves: leaving the buffer live until then
          // would let the next key be read as a second pick for the same pinyin.
          const query = activeBuffer;
          const index = selectedIndex;
          // Where the caret stood when the key was pressed, so a character typed
          // while the page read is in flight lands after the committed one.
          const at = insertPosRef.current;
          bufferRef.current = '';
          setCompositionBuffer('');
          // Committing inline keeps the common case synchronous, but only while the
          // queue is empty: a queued commit's length is what shifts the offset, so a
          // synchronous insert alongside one would be placed wrongly.
          const shown = commitPendingRef.current === 0 ? displayedCandidates() : null;
          if (shown) {
            if (shown.length === 0) {
              commitText(query, at, '');
            } else {
              commitCandidateFrom(shown, index, at, '');
            }
          } else {
            enqueueCommit(async () => {
              const { candidates } = await runSearch(query, scriptRef.current);
              if (candidates.length === 0) {
                commitText(query, at, '');
              } else {
                commitCandidateFrom(candidates, index, at, '');
              }
            }, at);
          }
        } else {
          // Insert space in accepted text
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newText = before + ' ' + after;
          const newCursor = start + 1;
          setCommitted(newText);
          cursorToRestoreRef.current = newCursor;
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
        // Read the digit before yielding: the synthetic event must not be relied on
        // after the await.
        const digit = parseInt(e.key, 10);
        // Unlike Space, a digit can be out of range and swallowed, so the
        // composition is not consumed here -- doing that would destroy a buffer the
        // user still has in front of them. Instead the range is checked once the
        // search resolves, and the token drops this pick if another key got there
        // first.
        const query = activeBuffer;
        const page = currentPage;
        const token = pickTokenRef.current + 1;
        pickTokenRef.current = token;
        const at = insertPosRef.current;

        const actOn = (candidates: Candidate[]) => {
          const onPage = candidates.slice(page * pageSize, page * pageSize + pageSize);
          if (digit >= 1 && digit <= onPage.length) {
            commitCandidateFrom(candidates, digit - 1, at, query);
          }
          // Out of range: swallowed, and the composition is left exactly as it was.
        };

        const shown = displayedCandidates();
        if (shown) {
          actOn(shown);
        } else {
          enqueueCommit(async () => {
            const { candidates } = await runSearch(query, scriptRef.current);
            if (token !== pickTokenRef.current) return;
            actOn(candidates);
          }, at);
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
          if (isPending) return;
          // The committed character is whichever candidate is highlighted, so the same
          // in-flight search has to resolve before it can be chosen. The composition is
          // consumed now, for the same reason Space does it.
          const query = activeBuffer;
          const index = selectedIndex;
          const page = currentPage;
          const at = insertPosRef.current;
          bufferRef.current = '';
          setCompositionBuffer('');

          const commitWith = (candidates: Candidate[]) => {
            const onPage = candidates.slice(page * pageSize, page * pageSize + pageSize);
            const chosenHanzi = onPage.length > 0 ? onPage[index].hanzi : query;
            insertCommitted(chosenHanzi + mappedPunct, at);
            setCurrentPage(0);
            setSelectedIndex(0);
          };

          // Committing inline keeps the common case synchronous, but only while the
          // queue is empty: a queued commit's length is what shifts the offset, so a
          // synchronous insert alongside one would be placed wrongly.
          const shown = commitPendingRef.current === 0 ? displayedCandidates() : null;
          if (shown) {
            commitWith(shown);
          } else {
            enqueueCommit(async () => {
              commitWith((await runSearch(query, scriptRef.current)).candidates);
            }, at);
          }
        } else {
          const before = committedText.slice(0, start);
          const after = committedText.slice(end);
          const newCommitted = before + mappedPunct + after;
          const newCursor = start + mappedPunct.length;

          setCommitted(newCommitted);
          cursorToRestoreRef.current = newCursor;
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
            setCommitted(newText);
            setInsertPos(start);
          } else {
            setInsertPos(start);
          }
        }
        // The ref is the synchronous source of truth: a key event handled before
        // React re-renders still has to see the letter that was just added.
        const nextBuffer = bufferRef.current + e.key.toLowerCase();
        bufferRef.current = nextBuffer;
        setCompositionBuffer(nextBuffer);
        setCurrentPage(0);
        setSelectedIndex(0);
        return;
      }
    },
    [
      dictionaryStatus,
      runSearch,
      enqueueCommit,
      displayedCandidates,
      commitCandidateFrom,
      commitText,
      currentPage,
      pageSize,
      selectedIndex,
      insertPos,
      committedText,
      commitRaw,
      cancelComposition,
      nextPage,
      prevPage,
      moveSelection,
      setCommitted,
      setInsertPos,
      insertCommitted,
    ]
  );

  const toggleScript = useCallback(() => {
    setScript((prev) => {
      const next = prev === 'simplified' ? 'traditional' : 'simplified';
      // Update the ref now: the effect that mirrors it runs after this render, and a
      // key event in between would otherwise search the previous script.
      scriptRef.current = next;
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setCommitted('');
    bufferRef.current = '';
    setCompositionBuffer('');
    setInsertPos(0);
    setCurrentPage(0);
    setSelectedIndex(0);
    cursorToRestoreRef.current = 0;
  }, [setCommitted, setInsertPos]);

  return {
    script,
    setScript,
    toggleScript,
    dictionaryStatus,
    dictionaryError,
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
    searchStatus,
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

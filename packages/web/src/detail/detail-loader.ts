/**
 * The web app's one copy of the Candidate detail file (ADR 0002).
 *
 * Nothing is fetched until the first expand asks for it. Every candidate that asks while
 * the fetch is in flight waits on that same fetch, and once it arrives the file is held in
 * memory for the rest of the session. A failed load (offline, HTTP error, a file from
 * another build) is not kept: the next request tries again.
 */

import { loadDetailFile, type DetailFile } from '@pinyinduck/core';

export type DetailLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; file: DetailFile }
  | { status: 'failed'; error: string };

export interface DetailLoaderOptions {
  url: string;
  /** The dictionary's build id; a detail file from any other build is a failed load. */
  buildId: number;
  fetchImpl?: typeof fetch;
}

export interface DetailLoader {
  readonly state: DetailLoadState;
  /** Starts the fetch, unless the file is already held or on its way. */
  request(): void;
  /** Resolves once no fetch is in flight. */
  settled(): Promise<void>;
  /** Calls `listener` on every state change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createDetailLoader({ url, buildId, fetchImpl }: DetailLoaderOptions): DetailLoader {
  let state: DetailLoadState = { status: 'idle' };
  let inFlight: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const set = (next: DetailLoadState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get state() {
      return state;
    },
    request() {
      if (state.status === 'loading' || state.status === 'ready') return;
      set({ status: 'loading' });
      inFlight = loadDetailFile(url, buildId, fetchImpl ? { fetchImpl } : {}).then(
        (file) => set({ status: 'ready', file }),
        (err: unknown) => set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      );
    },
    settled() {
      return inFlight;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

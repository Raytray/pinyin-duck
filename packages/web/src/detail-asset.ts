/// <reference types="vite/client" />

/**
 * Where the gzipped Candidate detail file is served from (ADR 0002).
 *
 * Imported like the dictionary (see `dictionary-asset.ts`), so a production build emits a
 * content-hashed `assets/detail.bin-<hash>.gz`. Importing it only yields its URL: nothing is
 * downloaded until the first expand asks for it, so the initial download is unchanged.
 */
import detailUrl from './generated/detail.bin.gz?url';

export const DETAIL_URL: string = detailUrl;

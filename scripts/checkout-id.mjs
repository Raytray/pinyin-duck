/**
 * Names the checkout a dev server was started from, so the e2e suite can tell whether
 * the server on its port is serving this checkout's code.
 *
 * Locally, Playwright reuses whatever dev server is already listening on its port. When
 * that server belongs to another checkout or worktree, the suite would test that code
 * and report its result as this checkout's. The dev server answers `CHECKOUT_ID_PATH`
 * with `checkoutId(root)`, and the e2e global setup compares it with its own.
 *
 * The id is a hash rather than the path because the dev server listens on every
 * interface (`host: true`), and an absolute path would hand the home directory and user
 * name to anyone on the network.
 *
 * Plain Node, and outside any workspace, because both `packages/web/vite.config.ts` and
 * the root Playwright config import it.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

/** Served outside the app's base path, so it answers whatever BASE_PATH is. */
export const CHECKOUT_ID_PATH = '/__pinyinduck/checkout-id';

/** What a checkout id looks like, to tell one apart from a page the server fell back to. */
export const CHECKOUT_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * A short, stable id for the checkout rooted at `root`. Symlinks are resolved first, so
 * one checkout reached by two paths gets one id.
 *
 * @param {string} root
 * @returns {string}
 */
export function checkoutId(root) {
  return createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 16);
}

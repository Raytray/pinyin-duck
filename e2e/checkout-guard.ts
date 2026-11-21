import path from 'path';
import type { FullConfig } from '@playwright/test';
import {
  CHECKOUT_ID_PATH,
  CHECKOUT_ID_PATTERN,
  checkoutId,
} from '../scripts/checkout-id.mjs';

/** How long the dev server gets to say which checkout it serves. */
const ANSWER_TIMEOUT_MS = 10_000;

/**
 * Global setup: refuses to run the suite against a dev server from another checkout.
 *
 * Locally the config reuses a dev server already on the port, which keeps reruns fast
 * but means the suite tests whatever that server serves. Playwright starts or finds the
 * server before global setup runs, so by now something is listening; this asks it which
 * checkout it belongs to and stops the run, in words, when the answer isn't this one.
 *
 * A run pointed at a server explicitly with `E2E_BASE_URL` is left alone: that is a
 * deliberate choice of target, and it may not be a dev server at all.
 */
export default async function checkoutGuard(config: FullConfig) {
  if (process.env.E2E_BASE_URL) return;

  // Without these the guard can't check anything. Going ahead regardless would be the
  // silent run against an unknown server that it exists to prevent.
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('The checkout guard found no baseURL in the Playwright config.');
  if (!config.configFile) throw new Error('The checkout guard found no Playwright config file.');

  // The config sits at the repository root, which is the checkout the suite belongs to.
  await assertServesCheckout(baseURL, path.dirname(config.configFile));
}

/**
 * Throws, in words, unless the dev server at `baseURL` answers with the id of the
 * checkout rooted at `root`.
 */
export async function assertServesCheckout(
  baseURL: string,
  root: string,
  timeoutMs = ANSWER_TIMEOUT_MS
) {
  const url = new URL(CHECKOUT_ID_PATH, baseURL).href;

  let served: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    served = response.ok ? (await response.text()).trim() : '';
  } catch (err) {
    const why =
      err instanceof Error && err.name === 'TimeoutError'
        ? `it did not answer within ${timeoutMs / 1000}s`
        : String(err);
    throw new Error(`Could not ask the dev server at ${baseURL} which checkout it serves: ${why}`);
  }

  if (served === checkoutId(root)) return;

  const port = Number(new URL(baseURL).port);
  const reason = CHECKOUT_ID_PATTERN.test(served)
    ? 'is serving a different checkout or worktree'
    : 'does not say which checkout it serves, so it is another app or a checkout from before this check';
  throw new Error(
    [
      '',
      `The dev server already listening at ${baseURL} ${reason}.`,
      `Running the e2e suite against it would test that code, not this checkout:`,
      `  ${root}`,
      '',
      'Either stop that dev server, or run this checkout on a port nothing else uses, e.g.:',
      `  E2E_PORT=${port + 1} npm run test:e2e`,
      '',
    ].join('\n')
  );
}

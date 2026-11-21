import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { test, expect } from '@playwright/test';
import type { FullConfig } from '@playwright/test';
import checkoutGuard, { assertServesCheckout } from './checkout-guard.js';
import { CHECKOUT_ID_PATH, checkoutId } from '../scripts/checkout-id.mjs';

/**
 * The checkout guard, run against stub servers rather than a real dev server.
 *
 * Every e2e run already proves the guard accepts this checkout's own server: if it
 * didn't, nothing would run. What a normal run can't show is that it still turns away
 * everything else, so each kind of foreign server gets a case here.
 */

const ROOT = path.resolve('.');

/** Starts a server that handles every request with `handler`, on a free port. */
async function stub(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A server that answers the checkout-id path with `id`, as the dev server does. */
const answering = (id: string) =>
  stub((req, res) => {
    if (req.url === CHECKOUT_ID_PATH) res.end(id);
    else res.end('<!doctype html><html></html>');
  });

test('accepts a server that answers with this checkout id', async () => {
  const server = await answering(checkoutId(ROOT));
  try {
    await expect(assertServesCheckout(server.baseURL, ROOT)).resolves.toBeUndefined();
  } finally {
    await server.close();
  }
});

test('turns away a server from another checkout', async () => {
  const server = await answering('0123456789abcdef');
  try {
    await expect(assertServesCheckout(server.baseURL, ROOT)).rejects.toThrow(
      'is serving a different checkout or worktree'
    );
  } finally {
    await server.close();
  }
});

// Vite's SPA fallback answers an unknown path with the app's index.html and a 200, which
// is what a dev server from before the guard does.
test('turns away a server that answers with a page instead of an id', async () => {
  const server = await stub((_req, res) => res.end('<!doctype html><html></html>'));
  try {
    await expect(assertServesCheckout(server.baseURL, ROOT)).rejects.toThrow(
      'does not say which checkout it serves'
    );
  } finally {
    await server.close();
  }
});

test('turns away a server that answers with an error', async () => {
  const server = await stub((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  try {
    await expect(assertServesCheckout(server.baseURL, ROOT)).rejects.toThrow(
      'does not say which checkout it serves'
    );
  } finally {
    await server.close();
  }
});

test('gives up on a server that never answers', async () => {
  const server = await stub(() => {});
  try {
    await expect(assertServesCheckout(server.baseURL, ROOT, 200)).rejects.toThrow(
      'did not answer within 0.2s'
    );
  } finally {
    await server.close();
  }
});

test('names the conflict, this checkout and another port to use', async () => {
  const server = await answering('0123456789abcdef');
  const port = Number(new URL(server.baseURL).port);
  try {
    const error = await assertServesCheckout(server.baseURL, ROOT).catch((err: Error) => err);
    expect(String(error)).toContain(server.baseURL);
    expect(String(error)).toContain(ROOT);
    expect(String(error)).toContain(`E2E_PORT=${port + 1} npm run test:e2e`);
  } finally {
    await server.close();
  }
});

test.describe('as global setup', () => {
  // Cleared so the cases below exercise the guard even when the suite itself was
  // pointed at a server with E2E_BASE_URL.
  let saved: string | undefined;
  test.beforeEach(() => {
    saved = process.env.E2E_BASE_URL;
    delete process.env.E2E_BASE_URL;
  });
  test.afterEach(() => {
    if (saved === undefined) delete process.env.E2E_BASE_URL;
    else process.env.E2E_BASE_URL = saved;
  });

  const config = (baseURL: string | undefined, configFile: string | undefined) =>
    ({ configFile, projects: [{ use: { baseURL } }] }) as unknown as FullConfig;

  test('refuses to run without a baseURL rather than skipping the check', async () => {
    await expect(
      checkoutGuard(config(undefined, path.join(ROOT, 'playwright.config.ts')))
    ).rejects.toThrow('found no baseURL');
  });

  test('refuses to run without a config file rather than skipping the check', async () => {
    await expect(checkoutGuard(config('http://127.0.0.1:1', undefined))).rejects.toThrow(
      'found no Playwright config file'
    );
  });

  test('stands aside when E2E_BASE_URL names the server to test', async () => {
    process.env.E2E_BASE_URL = 'http://127.0.0.1:1';
    await expect(checkoutGuard(config(undefined, undefined))).resolves.toBeUndefined();
  });
});

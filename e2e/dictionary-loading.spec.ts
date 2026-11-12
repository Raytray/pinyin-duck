import { readFileSync } from 'fs';
import path from 'path';
import { gunzipSync, gzipSync } from 'zlib';
import { test, expect } from './coverage-fixtures.js';
import { HEADER_SIZE, decodeDirectory, decodeHeader } from '../packages/core/src/data/btree-codec';
import {
  editor,
  candidateList,
  dictionaryStatus,
  dictionaryError,
  textLength,
  expectCandidates,
  gotoApp,
} from './helpers';

// The compressed asset: `/src/generated/dictionary.btree.gz` under the dev server, and a
// content-hashed `dictionary.btree-<hash>.gz` in a production build.
const DICTIONARY_ASSET = '**/dictionary.btree*.gz';

// The dictionary is fetched at runtime rather than bundled, so a missing or broken
// asset must degrade visibly instead of presenting an empty candidate list as if
// the pinyin simply had no matches.
test('reports the loaded dictionary and blocks commits until it is ready', async ({ page }) => {
  // Hold the asset open so the loading state is observable.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(DICTIONARY_ASSET, async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto('/');
  await expect(dictionaryStatus(page)).toContainText('Loading...');
  await expect(editor(page)).toBeFocused();

  // Typing works while the dictionary loads, but the popup must not claim there is
  // no match before the search has actually run.
  await editor(page).pressSequentially('nihao');
  await expect(page.locator('.candidate-empty-msg')).toContainText('Loading dictionary');

  // A commit key is swallowed rather than inserting raw pinyin the user did not ask for.
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('');
  await expect(page.locator('.candidate-empty-msg')).toContainText('"nihao"');

  release();
  await expect(dictionaryStatus(page)).toContainText('entries');
  // The buffer survived the transition, so composing can continue straight away.
  await expectCandidates(page, ['你好', '你', '呢', '尼', '妮']);
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('你好');
});

test('shows download progress while the dictionary loads', async ({ page }) => {
  // Throttle the connection so the multi-megabyte download takes long enough to watch.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: 1_500_000,
    uploadThroughput: -1,
  });

  await page.goto('/');
  // A percentage when the response says how big the asset is, otherwise megabytes so far.
  // Vite's servers send the .gz with `Content-Encoding: gzip`, so here it is megabytes.
  await expect(dictionaryStatus(page)).toContainText(/Loading\.\.\. (\d+%|\d+\.\d MB)/, {
    timeout: 15_000,
  });
  await expect(dictionaryStatus(page)).toContainText('entries', { timeout: 20_000 });
});

test('surfaces a failed dictionary load with a recovery hint', async ({ page }) => {
  await page.route(DICTIONARY_ASSET, (route) =>
    route.fulfill({ status: 404, body: 'Not Found' })
  );

  await page.goto('/');
  await expect(dictionaryError(page)).toBeVisible();
  await expect(dictionaryError(page)).toContainText('Could not load the dictionary');
  await expect(dictionaryError(page)).toContainText('build:dict');
  await expect(dictionaryStatus(page)).toContainText('Failed to load');

  // The lookup failed for good, so the popup says so rather than "no match".
  await editor(page).pressSequentially('nihao');
  await expect(page.locator('.candidate-empty-msg')).toContainText('Dictionary unavailable');

  // Raw pinyin can still be committed, otherwise a failed asset would trap the user.
  await editor(page).press('Enter');
  await expect(editor(page)).toHaveValue('nihao');
});

test('rejects a malformed dictionary payload', async ({ page }) => {
  await page.route(DICTIONARY_ASSET, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: JSON.stringify({ not: 'a dictionary' }),
    })
  );

  await page.goto('/');
  await expect(dictionaryError(page)).toContainText('Could not load the dictionary');
  await expect(candidateList(page)).toHaveCount(0);
});

test('reports a dictionary payload that is not a B-tree asset at all', async ({ page }) => {
  // A truncated or proxied asset fails to parse, which rejects with a decoder error
  // rather than the Error the loader raises itself. The message must still be shown
  // instead of a blank banner.
  await page.route(DICTIONARY_ASSET, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: '<html>oops</html>' })
  );

  await page.goto('/');
  await expect(dictionaryError(page)).toContainText('Could not load the dictionary');
  // The parse error is a real message rather than an empty or "undefined" one.
  await expect(page.locator('.dictionary-error span')).not.toBeEmpty();
  await expect(dictionaryStatus(page)).toContainText('Failed to load');
});

/** The real asset, gzipped, with its root page's kind byte corrupted. */
function assetWithCorruptRoot(): Buffer {
  const asset = gunzipSync(
    readFileSync(path.resolve(__dirname, '../packages/web/src/generated/dictionary.btree.gz'))
  );
  const header = decodeHeader(asset.subarray(0, HEADER_SIZE));
  const directory = decodeDirectory(
    asset.subarray(header.directoryOffset, header.directoryOffset + header.pageCount * 8),
    header.pageCount
  );
  asset[directory[header.rootPageId].offset] = 0x7f;
  return gzipSync(asset);
}

test('surfaces a corrupt dictionary page instead of showing no match', async ({ page }) => {
  // The header and directory are intact, so the asset opens, but every search reaches
  // the broken root page. That must not look like a pinyin with no candidates.
  const body = assetWithCorruptRoot();
  await page.route(DICTIONARY_ASSET, (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body })
  );

  await page.goto('/');
  await expect(dictionaryStatus(page)).toContainText('entries');

  await editor(page).pressSequentially('nihao');
  await expect(dictionaryError(page)).toContainText('malformed or truncated');
  await expect(dictionaryError(page)).toContainText('build:dict');
  await expect(dictionaryStatus(page)).toContainText('Failed to load');
  await expect(page.locator('.candidate-empty-msg')).toContainText('Dictionary unavailable');

  // As with any failed dictionary, the pinyin typed can still be committed.
  await editor(page).press('Enter');
  await expect(editor(page)).toHaveValue('nihao');
});

test('stringifies a load failure that is not an Error instance', async ({ page }) => {
  // A fetch shim or service worker can reject with a plain value rather than an Error.
  // Reading `.message` off that would render an empty banner, so it is stringified.
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('dictionary.btree')) {
        return Promise.reject('dictionary asset unreachable');
      }
      return realFetch(input, init);
    }) as typeof window.fetch;
  });

  await page.goto('/');

  await expect(dictionaryError(page)).toContainText('Could not load the dictionary');
  await expect(page.locator('.dictionary-error span')).toHaveText('dictionary asset unreachable');
  await expect(dictionaryStatus(page)).toContainText('Failed to load');
});

test('still commits newline and plain text when the dictionary failed', async ({ page }) => {
  await page.route(DICTIONARY_ASSET, (route) =>
    route.fulfill({ status: 500, body: 'boom' })
  );

  await page.goto('/');
  await expect(dictionaryError(page)).toBeVisible();

  await editor(page).pressSequentially('7');
  await expect(editor(page)).toHaveValue('7');

  await editor(page).press('Enter');
  await expect(editor(page)).toHaveValue('7\n');
  await expect(textLength(page)).toContainText('Length: 2 characters');
});

test('serves the full CC-CEDICT asset', async ({ page }) => {
  await gotoApp(page);

  // A floor, not an exact count. The status line reports the entry count of the whole
  // corpus, which moves whenever `build:dict` picks up a newer CC-CEDICT release or a
  // different frequency list, so pinning it here would fail on a dictionary rebuild that
  // changed nothing about this app. What the test is actually for is the claim in its
  // name: the full asset is served, not a seed list or a truncated page. A stubbed or
  // partially built dictionary would report a small number, which is what this catches.
  // The Android suite pins the same asset the same way.
  const status = await dictionaryStatus(page).innerText();
  const entries = Number(status.replace(/[^\d]/g, ''));

  expect(entries, `dictionary status did not report an entry count: ${status}`).toBeGreaterThan(
    100_000
  );
});

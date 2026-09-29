import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateList,
  gotoApp,
  dictionaryStatus,
  dictionaryError,
  textLength,
  expectCandidates,
} from './helpers';

// The dictionary is fetched at runtime rather than bundled, so a missing or broken
// asset must degrade visibly instead of presenting an empty candidate list as if
// the pinyin simply had no matches.
test('reports the loaded dictionary and blocks commits until it is ready', async ({ page }) => {
  // Hold the asset open so the loading state is observable.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/dictionary.btree', async (route) => {
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

test('surfaces a failed dictionary load with a recovery hint', async ({ page }) => {
  await page.route('**/dictionary.btree', (route) =>
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
  await page.route('**/dictionary.btree', (route) =>
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
  await page.route('**/dictionary.btree', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: '<html>oops</html>' })
  );

  await page.goto('/');
  await expect(dictionaryError(page)).toContainText('Could not load the dictionary');
  // The parse error is a real message rather than an empty or "undefined" one.
  await expect(page.locator('.dictionary-error span')).not.toBeEmpty();
  await expect(dictionaryStatus(page)).toContainText('Failed to load');
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
  await page.route('**/dictionary.btree', (route) =>
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
  // 125,132 lines parsed into 122,746 unique word/reading pairs.
  await expect(dictionaryStatus(page)).toContainText('122,746 entries');
});

import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateList,
  scriptToggle,
  clearButton,
  copyButton,
  gotoApp,
  expectCandidates,
  expectGlosses,
  textLength,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('starts in simplified script', async ({ page }) => {
  await expect(scriptToggle(page)).toContainText('简体 (Simplified)');

  await editor(page).pressSequentially('xiexie');
  await expectCandidates(page, ['谢谢', '泄泻', '写', '些', '鞋']);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('谢谢');
});

test('renders traditional characters after the script toggle', async ({ page }) => {
  await scriptToggle(page).click();
  await expect(scriptToggle(page)).toContainText('繁體 (Traditional)');

  await editor(page).pressSequentially('xiexie');
  await expectCandidates(page, ['謝謝', '泄瀉', '寫', '些', '鞋']);
  await expectGlosses(page, [
    'to thank / thanks / thank you',
    '(TCM) to have diarrhea',
    'to write',
    'classifier indicating a small amount or small number greater tha…',
    'shoe',
  ]);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('謝謝');
});

test('toggles back to simplified without losing the composition buffer', async ({ page }) => {
  await scriptToggle(page).click();

  await editor(page).pressSequentially('zaijian');
  await expectCandidates(page, ['再見', '在建', '再建', '在', '再']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');

  await scriptToggle(page).click();
  await expectCandidates(page, ['再见', '在建', '再建', '在', '再']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');
});

test('toggles script for a character that differs between the two scripts', async ({ page }) => {
  await editor(page).pressSequentially('zhongguo');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国');

  await editor(page).pressSequentially('beijing');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国北京');

  // Committed text is not rewritten; only new candidates change script.
  await expect(editor(page)).toHaveValue('中国北京');
});

test('disables Copy and Clear until there is text to act on', async ({ page }) => {
  await expect(copyButton(page)).toBeDisabled();
  await expect(clearButton(page)).toBeDisabled();

  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await expect(copyButton(page)).toBeEnabled();
  await expect(clearButton(page)).toBeEnabled();
});

test('clears committed text and any active composition', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await clearButton(page).click();

  await expect(editor(page)).toHaveValue('');
  await expect(candidateList(page)).toHaveCount(0);
  await expect(clearButton(page)).toBeDisabled();
  await expect(textLength(page)).toContainText('Length: 0 characters');
});

test('copies the committed text to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await copyButton(page).click();

  await expect(copyButton(page)).toContainText('Copied!');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe('你好');
});

test('leaves the editor intact when the clipboard write is rejected', async ({ page }) => {
  // The clipboard can be unavailable (no permission, insecure context, denied by the
  // OS). That must not throw out of the click handler or clear the text.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('clipboard blocked')),
        readText: () => Promise.reject(new Error('clipboard blocked')),
      },
    });
  });

  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await copyButton(page).click();

  // The button never flips to its transient "Copied!" state...
  await expect(copyButton(page)).toContainText('Copy');
  // ...and the committed text survives the failed copy.
  await expect(editor(page)).toHaveValue('你好');
  await expect(copyButton(page)).toBeEnabled();
});

test('credits the dictionary sources and their licenses', async ({ page }) => {
  // The page downloads a CC BY-SA dictionary, so the credit has to be reachable from it.
  const credits = page.getByRole('dialog', { name: 'Credits' });
  await expect(credits).toBeHidden();

  await page.getByRole('button', { name: 'Credits' }).click();
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('licensed under CC BY-SA 4.0');
  for (const [name, href] of [
    ['CC-CEDICT', 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict'],
    ['FrequencyWords (OpenSubtitles 2018)', 'https://github.com/hermitdave/FrequencyWords'],
    ['HSK 2012 word list', 'https://github.com/gigacool/hanyu-shuiping-kaoshi'],
  ]) {
    await expect(credits.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await expect(credits).toContainText('MDBG');
  await expect(credits).toContainText('Hermit Dave');
  await expect(credits).toContainText('gigacool');

  await credits.getByRole('button', { name: 'Close credits' }).click();
  await expect(credits).toBeHidden();

  // Escape closes it too, and typing carries on afterwards.
  await page.getByRole('button', { name: 'Credits' }).click();
  await page.keyboard.press('Escape');
  await expect(credits).toBeHidden();
  await editor(page).pressSequentially('xiexie');
  await expectCandidates(page, ['谢谢', '泄泻', '写', '些', '鞋']);
});

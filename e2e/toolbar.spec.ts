import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateItems,
  candidateList,
  scriptToggle,
  clearButton,
  copyButton,
  gotoApp,
  expectCandidates,
  expectGlosses,
  textLength,
} from './helpers';
import { expectSentenceRow } from './sentence-helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('starts in simplified script', async ({ page }) => {
  await expect(scriptToggle(page)).toContainText('简体 (Simplified)');

  await editor(page).pressSequentially('xiexie');
  // 写些 is the Sentence candidate, right after the words that cover the whole query.
  await expectCandidates(page, ['谢谢', '泄泻', '写些', '写', '些']);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('谢谢');
});

test('renders traditional characters after the script toggle', async ({ page }) => {
  await scriptToggle(page).click();
  await expect(scriptToggle(page)).toContainText('繁體 (Traditional)');

  await editor(page).pressSequentially('xiexie');
  // 洩瀉 shares 泄泻 with 泄瀉, so it is a candidate of its own only in traditional script.
  await expectCandidates(page, ['謝謝', '泄瀉', '洩瀉', '寫些', '寫']);
  // The word rows' glosses; the Sentence candidate 寫些 glosses each of its words instead.
  await expectGlosses(page, ['to thank / thanks / thank you', '(TCM) to have diarrhea', 'variant of 泄瀉|泄泻', 'to write']);
  await expectSentenceRow(candidateItems(page).nth(3), [
    { pinyin: 'xiě', hanzi: '寫', gloss: 'to write' },
    { pinyin: 'xiē', hanzi: '些', gloss: 'classifier indicating a small amount or small number greater tha…' },
  ]);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('謝謝');
});

test('toggles back to simplified without losing the composition buffer', async ({ page }) => {
  await scriptToggle(page).click();

  await editor(page).pressSequentially('zaijian');
  await expectCandidates(page, ['再見', '在建', '再建', '再見全壘打', '在監獄']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');

  await scriptToggle(page).click();
  await expectCandidates(page, ['再见', '在建', '再建', '再见全垒打', '在监狱']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');
});

test('toggles script for a character that differs between the two scripts', async ({ page }) => {
  await editor(page).pressSequentially('zhongguo');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国');

  await editor(page).pressSequentially('beijing');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国背景');

  // Committed text is not rewritten; only new candidates change script.
  await expect(editor(page)).toHaveValue('中国背景');
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
    ['HSK 3.0 syllabus (2025)', 'https://www.chinesetest.cn/'],
    ['English Wiktionary', 'https://en.wiktionary.org/'],
    ['HanDeDict', 'https://github.com/gugray/HanDeDict'],
  ]) {
    await expect(credits.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  await expect(credits).toContainText('MDBG');
  await expect(credits).toContainText('Hermit Dave');
  // The HSK levels come from an unlicensed official syllabus: only the levels are taken.
  await expect(credits).toContainText('Center for Language Education and Cooperation (中外语言交流合作中心)');
  await expect(credits).toContainText('No licence · levels only');
  await expect(credits).toContainText('Source: www.chinesetest.cn');
  // Part of speech: the dump date and commit they were taken from, and what was taken.
  await expect(credits).toContainText('Wiktionary contributors');
  await expect(credits).toContainText('dump 2026-10-01');
  await expect(credits).toContainText('HanDeDict contributors');
  await expect(credits).toContainText('commit 0760a107');
  await expect(credits).toContainText('CC BY-SA 2.0 DE / 3.0, adapted under 4.0');
  await expect(credits.getByText('word-class tags only, mapped')).toHaveCount(2);

  await credits.getByRole('button', { name: 'Close credits' }).click();
  await expect(credits).toBeHidden();

  // Escape closes it too, and typing carries on afterwards.
  await page.getByRole('button', { name: 'Credits' }).click();
  await page.keyboard.press('Escape');
  await expect(credits).toBeHidden();
  await editor(page).pressSequentially('xiexie');
  // 写些 is the Sentence candidate, right after the words that cover the whole query.
  await expectCandidates(page, ['谢谢', '泄泻', '写些', '写', '些']);
});

// "fafang" has 24 traditional candidates but 19 simplified ones (one simplified candidate
// can stand for several headwords, such as 发 for 發 and 髮), so the last traditional
// candidate is past the end of the simplified list.
async function highlightLastTraditionalFafang(page: Page) {
  await scriptToggle(page).click();
  await editor(page).pressSequentially('fafang');
  for (let i = 0; i < 4; i++) await editor(page).press(']');
  for (let i = 0; i < 3; i++) await editor(page).press('ArrowRight');
  await expectCandidates(page, ['筏', '茷', '醱', '鍅']);
  await expect(page.locator('.candidate-hanzi').nth(3)).toHaveText('鍅');
}

test('a script toggle mid-composition goes back to the first candidate for punctuation', async ({
  page,
}) => {
  await highlightLastTraditionalFafang(page);

  await scriptToggle(page).click();
  await expectCandidates(page, ['发放', '法放', '发', '法', '罚']);

  await editor(page).press(',');
  await expect(editor(page)).toHaveValue('发放，');
});

test('a script toggle mid-composition goes back to the first candidate for Space', async ({
  page,
}) => {
  await highlightLastTraditionalFafang(page);

  await scriptToggle(page).click();
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('发放');
});

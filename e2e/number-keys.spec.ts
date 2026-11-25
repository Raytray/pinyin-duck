import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateList,
  candidateItems,
  gotoApp,
  expectCandidates,
} from './helpers';

// Digits are a candidate-pick shortcut for the whole time a composition is active.
// They never reach the buffer, so tone numbers such as "shi4" cannot be typed from
// the keyboard; the search engine still supports them for direct callers, and that
// filtering is covered by the unit tests in packages/core.
test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('picks a candidate with a digit while composing', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '事', '十', '时', '室']);

  await editor(page).press('4');

  await expect(editor(page)).toHaveValue('时');
  await expect(candidateList(page)).toHaveCount(0);
});

test('treats a digit as a pick even when it reads like a tone number', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await editor(page).pressSequentially('4');

  await expect(editor(page)).toHaveValue('时');
  await expect(candidateList(page)).toHaveCount(0);
});

test('swallows a digit that is out of range for the visible page', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '事', '十', '时', '室']);

  await editor(page).press('7');

  // The composition survives, the buffer is untouched, nothing is committed.
  await expect(page.locator('.candidate-buffer-text')).toHaveText('shi');
  await expect(editor(page)).toHaveValue('');
  await expectCandidates(page, ['是', '事', '十', '时', '室']);
  await expect(candidateItems(page).first()).toHaveAttribute('aria-selected', 'true');
});

test('swallows 0 while composing because it is not a candidate index', async ({ page }) => {
  await editor(page).pressSequentially('shi');

  await editor(page).press('0');

  await expect(page.locator('.candidate-buffer-text')).toHaveText('shi');
  await expect(editor(page)).toHaveValue('');
});

test('keeps the buffer free of digits when the candidate count is small', async ({ page }) => {
  // A query that resolves to a single reading: 1 picks it, and any other digit is
  // out of range for the one-card page. "zhongguo" is no longer single-result in
  // the full dictionary, so this uses a rarer syllable pair.
  await editor(page).pressSequentially('kuaile');
  const shown = await candidateItems(page).count();
  expect(shown).toBeLessThanOrEqual(5);

  await editor(page).press('9');
  await expect(page.locator('.candidate-buffer-text')).toHaveText('kuaile');

  await editor(page).press('1');
  await expect(editor(page)).toHaveValue('快乐');
});

test('inserts digits as plain text when no composition is active', async ({ page }) => {
  await editor(page).pressSequentially('7');
  await expect(editor(page)).toHaveValue('7');

  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');
  await editor(page).press('5');

  await expect(editor(page)).toHaveValue('7你好5');
});

test('types digits into committed text after a commit', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await editor(page).pressSequentially('2026');

  await expect(editor(page)).toHaveValue('你好2026');
  await expect(candidateList(page)).toHaveCount(0);
});

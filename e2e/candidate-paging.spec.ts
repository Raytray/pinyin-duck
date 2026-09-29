import { test, expect } from '@playwright/test';
import {
  editor,
  candidateItems,
  pageCounter,
  nextPageButton,
  prevPageButton,
  gotoApp,
  expectCandidates,
  expectGlosses,
  expectNoMatches,
} from './helpers';

// "ta" resolves to 6 homophones, which spans two pages at the app's page size of 5.
const TA_PAGE_ONE = ['他', '她', '它', '他们', '踏'];
const TA_PAGE_TWO = ['塌'];

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await editor(page).pressSequentially('ta');
  await expect(page.locator('.candidate-hanzi')).not.toHaveCount(0);
});

test('splits homophones across pages and reports the page count', async ({ page }) => {
  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 2');
  await expect(prevPageButton(page)).toBeDisabled();
  await expect(nextPageButton(page)).toBeEnabled();
});

test('advances pages with the next button', async ({ page }) => {
  await nextPageButton(page).click();

  await expectCandidates(page, TA_PAGE_TWO);
  await expect(pageCounter(page)).toHaveText('2 / 2');
  await expect(nextPageButton(page)).toBeDisabled();
  await expect(prevPageButton(page)).toBeEnabled();
});

test('advances and returns with PageDown and PageUp', async ({ page }) => {
  await editor(page).press('PageDown');
  await expectCandidates(page, TA_PAGE_TWO);
  await expect(pageCounter(page)).toHaveText('2 / 2');

  await editor(page).press('PageUp');
  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 2');
});

test('advances and returns with the bracket shortcuts', async ({ page }) => {
  await editor(page).press(']');
  await expectCandidates(page, TA_PAGE_TWO);

  await editor(page).press('[');
  await expectCandidates(page, TA_PAGE_ONE);
});

test('commits a candidate from the second page', async ({ page }) => {
  await editor(page).press(']');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('塌');
});

test('moves the selection with the arrow keys and commits the highlighted candidate', async ({
  page,
}) => {
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'true');

  await editor(page).press('ArrowDown');
  await expect(candidateItems(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await editor(page).press('ArrowDown');
  await expect(candidateItems(page).nth(2)).toHaveAttribute('aria-selected', 'true');

  await editor(page).press('ArrowUp');
  await expect(candidateItems(page).nth(1)).toHaveAttribute('aria-selected', 'true');

  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('她');
});

test('rolls the arrow selection onto the next page at the end of the list', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await editor(page).press('ArrowDown');
  }

  await expectCandidates(page, TA_PAGE_TWO);
  await expect(pageCounter(page)).toHaveText('2 / 2');
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'true');

  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('塌');
});

test('moves the selection back to the last entry of the previous page', async ({ page }) => {
  await editor(page).press(']');
  await expectCandidates(page, TA_PAGE_TWO);

  await editor(page).press('ArrowUp');

  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 2');
  await expect(candidateItems(page).nth(4)).toHaveAttribute('aria-selected', 'true');
});

test('moves the selection on hover', async ({ page }) => {
  await candidateItems(page).nth(3).hover();

  await expect(candidateItems(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'false');
});

test('commits a partial match and keeps the leftover pinyin buffered', async ({ page }) => {
  // "nihao" offers 你 as a partial match that leaves "hao" in the buffer.
  await editor(page).press('Escape');
  await editor(page).pressSequentially('nihao');
  await expectGlosses(page, ['hello / how are you', 'you (singular)']);

  await editor(page).press('2');

  await expect(editor(page)).toHaveValue('你');
  // The leftover syllable is re-queried; it has no entry of its own.
  await expectNoMatches(page, 'hao');
  await expect(page.locator('.status-item').nth(1)).toContainText('Length: 1 characters');
});

test('resets paging when the buffer changes', async ({ page }) => {
  await editor(page).press(']');
  await expect(pageCounter(page)).toHaveText('2 / 2');

  await editor(page).press('Backspace');

  await expect(page.locator('.candidate-buffer-text')).toHaveText('t');
  await expect(pageCounter(page)).toHaveText('1 / 2');
  await expectCandidates(page, ['他', '她', '他们', '它', '天安门']);
});

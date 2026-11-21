import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateItems,
  pageCounter,
  nextPageButton,
  prevPageButton,
  gotoApp,
  expectCandidates,
  expectGlosses,
  expectBuffer,
  pinyinBufferTag,
  textLength,
} from './helpers';

// "ta" has 1476 readings in CC-CEDICT. The hook caps a search at 50 candidates, so
// the popup always reports 10 pages at the app's page size of 5, and page two holds
// the sixth-ranked reading rather than the only remaining one.
const TA_PAGE_ONE = ['他', '她', '它', '塔', 'TA'];
const TA_PAGE_TWO = ['塌', '祂', '嗒', '踏', '拓'];

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await editor(page).pressSequentially('ta');
  await expect(page.locator('.candidate-hanzi')).not.toHaveCount(0);
});

test('splits homophones across pages and reports the page count', async ({ page }) => {
  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 10');
  await expect(prevPageButton(page)).toBeDisabled();
  await expect(nextPageButton(page)).toBeEnabled();
});

test('advances pages with the next button', async ({ page }) => {
  await nextPageButton(page).click();

  await expectCandidates(page, TA_PAGE_TWO);
  await expect(pageCounter(page)).toHaveText('2 / 10');
  await expect(nextPageButton(page)).toBeEnabled();
  await expect(prevPageButton(page)).toBeEnabled();
});

test('disables Next on the last page and stops there', async ({ page }) => {
  // 1476 readings are capped at 50 candidates, so page 10 is the last one.
  for (let current = 2; current <= 10; current++) {
    await nextPageButton(page).click();
    await expect(pageCounter(page)).toHaveText(`${current} / 10`);
  }

  await expect(nextPageButton(page)).toBeDisabled();
  await expect(prevPageButton(page)).toBeEnabled();

  // Pressing the shortcut past the end must not wrap around.
  await editor(page).press(']');
  await expect(pageCounter(page)).toHaveText('10 / 10');
});

test('advances and returns with PageDown and PageUp', async ({ page }) => {
  await editor(page).press('PageDown');
  await expectCandidates(page, TA_PAGE_TWO);
  await expect(pageCounter(page)).toHaveText('2 / 10');

  await editor(page).press('PageUp');
  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 10');
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
  // Wait for the first candidate to be selected (selectedIndex = 0 is set on buffer change)
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });

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
  await expect(pageCounter(page)).toHaveText('2 / 10');
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'true');

  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('塌');
});

test('moves the selection back to the last entry of the previous page', async ({ page }) => {
  await editor(page).press(']');
  await expectCandidates(page, TA_PAGE_TWO);

  await editor(page).press('ArrowUp');

  await expectCandidates(page, TA_PAGE_ONE);
  await expect(pageCounter(page)).toHaveText('1 / 10');
  await expect(candidateItems(page).nth(4)).toHaveAttribute('aria-selected', 'true');
});

test('moves the selection on hover', async ({ page }) => {
  await candidateItems(page).nth(3).hover();

  await expect(candidateItems(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'false');
});

test('commits a partial match and keeps the leftover pinyin buffered', async ({ page }) => {
  // "nihao" offers 你 as a partial match that leaves "hao" in the buffer, so
  // committing it commits one character and resumes composition on the remainder.
  await editor(page).press('Escape');
  await editor(page).pressSequentially('nihao');
  await expectGlosses(page, [
    'hello; hi',
    // 你 stands for both 你 and 妳 in simplified script, so its gloss joins the first sense
    // of each (ADR 0001).
    'you (informal, as opposed to courteous 您) / you (Note: In Taiwan…',
    'dense wool fabric (used for coats and jackets)',
    'Buddhist nun / (often used in phonetic spellings)',
    'girl / phonetic "ni" (in female names) / Taiwan pr.',
  ]);

  await editor(page).press('2');

  await expect(editor(page)).toHaveValue('你');
  // The leftover syllable is re-queried; "hao" has readings of its own in the
  // full dictionary, so the popup stays open on them.
  await expectBuffer(page, 'hao');
  await expectCandidates(page, ['好', '号', '浩', '豪', '嚎']);
  await expect(textLength(page)).toContainText('Length: 1 characters');
});

test('resets paging when the buffer changes', async ({ page }) => {
  await editor(page).press(']');
  await expect(pageCounter(page)).toHaveText('2 / 10');

  await editor(page).press('Backspace');

  await expect(pinyinBufferTag(page)).toHaveText('t');
  await expect(pageCounter(page)).toHaveText('1 / 10');
  await expectCandidates(page, ['T', '他', '她', '听', '太']);
});

import { Page, expect } from '@playwright/test';

export const editor = (page: Page) => page.getByLabel('Pinyin composition input');

export const candidateList = (page: Page) =>
  page.getByRole('listbox', { name: 'Pinyin Candidates' });

export const candidateItems = (page: Page) => candidateList(page).getByRole('option');

export const pinyinBufferTag = (page: Page) => page.locator('.candidate-buffer-text');

export const pageCounter = (page: Page) => page.locator('.candidate-count-tag');

export const scriptToggle = (page: Page) =>
  page.getByTitle('Toggle between Simplified and Traditional Chinese');

export const clearButton = (page: Page) => page.getByTitle('Clear editor');

export const copyButton = (page: Page) => page.getByTitle('Copy text to clipboard');

export const nextPageButton = (page: Page) => page.getByTitle('Next page (PageDown or ])');

export const prevPageButton = (page: Page) => page.getByTitle('Previous page (PageUp or [)');

export const textLength = (page: Page) => page.getByTestId('text-length');

export const dictionaryStatus = (page: Page) => page.getByTestId('dictionary-status');

export const dictionaryError = (page: Page) => page.getByRole('alert');

/**
 * Navigates to the app and waits for the editor to be focused and the dictionary
 * to finish loading. Candidate assertions are only meaningful once the full
 * CC-CEDICT asset has been fetched and indexed.
 */
export async function gotoApp(page: Page) {
  await page.goto('/');
  await expect(dictionaryStatus(page)).toContainText('entries');
  await expect(editor(page)).toBeFocused();
}

/** Asserts the hanzi of the visible candidates, in order. */
export async function expectCandidates(page: Page, expected: string[]) {
  await expect(page.locator('.candidate-hanzi')).toHaveText(expected);
}

/** Asserts the tone-marked pinyin of the visible candidates, in order. */
export async function expectPinyin(page: Page, expected: string[]) {
  await expect(page.locator('.candidate-pinyin')).toHaveText(expected);
}

/** Asserts the English gloss of the visible candidates, in order. */
export async function expectGlosses(page: Page, expected: string[]) {
  await expect(page.locator('.candidate-gloss')).toHaveText(expected);
}

/** Asserts the raw pinyin echoed in the candidate popup header. */
export async function expectBuffer(page: Page, buffer: string) {
  await expect(pinyinBufferTag(page)).toHaveText(buffer);
}

/** Asserts the popup is showing the no-match state for the given buffer. */
export async function expectNoMatches(page: Page, buffer: string) {
  await expect(page.locator('.candidate-empty-msg')).toContainText(`No exact match for "${buffer}"`);
  await expect(page.locator('.candidate-empty-hint')).toContainText('Press Enter to insert English');
}

import { expect, type Locator, type Page } from '@playwright/test';

/** One word of a Sentence candidate as its row draws it. */
export interface SentenceWord {
  pinyin: string;
  hanzi: string;
  gloss: string;
}

/** The word blocks of a candidate row: none on a word candidate. */
export const sentenceWords = (row: Locator) => row.locator('.sentence-word');

/** Asserts a row draws exactly these words, in order, each as pinyin, Hanzi and gloss. */
export async function expectSentenceRow(row: Locator, words: SentenceWord[]) {
  const blocks = sentenceWords(row);
  await expect(blocks.locator('.sentence-word-pinyin')).toHaveText(words.map((w) => w.pinyin));
  await expect(blocks.locator('.sentence-word-hanzi')).toHaveText(words.map((w) => w.hanzi));
  await expect(blocks.locator('.sentence-word-gloss')).toHaveText(words.map((w) => w.gloss));
}

/** The open Candidate detail. */
export const candidateDetail = (page: Page) => page.getByRole('region', { name: 'Candidate detail' });

/** The per-word sections of an open Sentence candidate's detail, one under another. */
export const detailWordSections = (page: Page) => candidateDetail(page).locator('.detail-word');

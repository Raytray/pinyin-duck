import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixtures.js';
import { candidateItems, candidateList, editor, expectNoMatches, gotoApp } from './helpers';
import { candidateDetail, detailWordSections, expectSentenceRow, sentenceWords } from './sentence-helpers';

// A Sentence candidate's row draws each word as its own block (pinyin over Hanzi over a
// one-sense gloss), and a partial one ends with its leftover pinyin marked "next".
// Committing takes exactly what the candidate covers. The decision is #31; ranking is #30.

const FULL = 'woxianghekafei';
const PARTIAL = 'woxianghekafeiqqq';
const LONG = 'woxianghekafeiranhouquyiyuankanyisheng';

const COFFEE_WORDS = [
  { pinyin: 'wǒ', hanzi: '我', gloss: 'I; me; my' },
  { pinyin: 'xiǎng', hanzi: '想', gloss: 'to think (about)' },
  { pinyin: 'hē', hanzi: '喝', gloss: 'to drink' },
  { pinyin: 'kā fēi', hanzi: '咖啡', gloss: 'coffee' },
];

const sentenceRow = (page: Page) => candidateItems(page).nth(0);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('the row', () => {
  test('a full sentence draws each word as pinyin over Hanzi over a one-sense gloss', async ({ page }) => {
    await editor(page).pressSequentially(FULL);

    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);
    await expect(sentenceRow(page).locator('.candidate-num')).toHaveText('1');
    await expect(sentenceRow(page).locator('.sentence-leftover')).toHaveCount(0);

    // Word candidates after it are drawn as before.
    const wordRow = candidateItems(page).nth(1);
    await expect(wordRow.locator('.candidate-hanzi')).toHaveText('我');
    await expect(wordRow.locator('.candidate-pinyin')).toHaveText('wǒ');
    await expect(wordRow.locator('.candidate-gloss')).toHaveText('I; me; my');
    await expect(sentenceWords(wordRow)).toHaveCount(0);
  });
});

test.describe('a partial sentence', () => {
  test('ends with a faded block holding the leftover pinyin, labelled "next" and underlined dashed', async ({
    page,
  }) => {
    await editor(page).pressSequentially(PARTIAL);

    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);
    const leftover = sentenceRow(page).locator('.sentence-leftover');
    await expect(leftover.locator('.sentence-leftover-pinyin')).toHaveText('qqq');
    await expect(leftover.locator('.sentence-leftover-label')).toHaveText('next');
    await expect(leftover.locator('.sentence-leftover-pinyin')).toHaveCSS('border-bottom-style', 'dashed');
    expect(Number(await leftover.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
  });

  test('Space commits the words it covers and leaves the leftover composing', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);
    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);

    await editor(page).press(' ');

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expectNoMatches(page, 'qqq');
  });

  test('a click anywhere on the row commits the covered words, leftover still composing', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);

    await sentenceRow(page).locator('.sentence-leftover').click();

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expectNoMatches(page, 'qqq');
    await expect(editor(page)).toBeFocused();
  });
});

test.describe('committing a full sentence', () => {
  test('Space commits the whole sentence', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);

    await editor(page).press(' ');

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });

  test('its number key commits the whole sentence', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);

    await editor(page).press('1');

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });

  test('clicking one word commits the whole sentence, not that word', async ({ page }) => {
    await editor(page).pressSequentially(FULL);

    await sentenceWords(sentenceRow(page)).nth(2).click();

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });
});

test.describe('Candidate detail', () => {
  test('Tab shows the whole sentence, then one section per word with its top two senses', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);

    await editor(page).press('Tab');

    const detail = candidateDetail(page);
    await expect(detail.locator('.detail-head .detail-hanzi')).toHaveText('我想喝咖啡');
    await expect(detail.locator('.detail-head .detail-reading')).toHaveText('wǒ xiǎng hē kā fēi');
    await expect(detail.locator('.detail-head')).not.toContainText('then compose');

    const sections = detailWordSections(page);
    await expect(sections.locator('.detail-word-hanzi')).toHaveText(['我', '想', '喝', '咖啡']);
    await expect(sections.locator('.detail-reading')).toHaveText(['wǒ', 'xiǎng', 'hē', 'kā fēi']);

    // 想 has five senses: the top two, then a count of the rest.
    const xiang = sections.nth(1);
    await expect(xiang.locator('.detail-sense')).toHaveText(['to think (about)', 'to think of; to devise']);
    await expect(xiang.locator('.detail-more')).toHaveText('+3 more');
    // 喝 has one, so nothing more to count.
    await expect(sections.nth(2).locator('.detail-sense')).toHaveText(['to drink']);
    await expect(sections.nth(2).locator('.detail-more')).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  });

  test('a word shows its traditional counterpart when it differs', async ({ page }) => {
    await editor(page).pressSequentially(LONG);
    await editor(page).press('Tab');

    const sections = detailWordSections(page);
    await expect(sections).toHaveCount(9);
    const yiyuan = sections.filter({ has: page.locator('.detail-word-hanzi', { hasText: /^医院$/ }) });
    await expect(yiyuan.locator('.detail-counterpart')).toHaveText('醫院');
    const wo = sections.nth(0);
    await expect(wo.locator('.detail-counterpart')).toHaveCount(0);
    // 去 has fourteen senses.
    await expect(sections.nth(5).locator('.detail-more')).toHaveText('+12 more');
  });

  test('a partial sentence says what composes next', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);
    await editor(page).press('Tab');

    await expect(candidateDetail(page).locator('.detail-head')).toContainText('then compose ‘qqq’');
  });

  test('tapping the sentence Hanzi in the header commits what the candidate covers', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);
    await editor(page).press('Tab');

    await candidateDetail(page).getByRole('button', { name: 'Use 我想喝咖啡' }).click();

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expectNoMatches(page, 'qqq');
    await expect(candidateDetail(page)).toHaveCount(0);
  });
});

test.describe('a long input', () => {
  test('draws every word, wrapping inside the popup, and Space commits them all', async ({ page }) => {
    await editor(page).pressSequentially(LONG);

    const row = sentenceRow(page);
    await expect(sentenceWords(row).locator('.sentence-word-hanzi')).toHaveText([
      '我', '想', '喝', '咖啡', '然后', '去', '医院', '看', '医生',
    ]);
    await expect(sentenceWords(row).locator('.sentence-word-gloss').nth(6)).toHaveText('hospital');
    // The row wraps rather than pushing the popup wider than its list.
    const list = candidateList(page).locator('.candidate-list');
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(row.getByRole('button', { name: 'Details for 我想喝咖啡然后去医院看医生' })).toBeVisible();

    await editor(page).press(' ');

    await expect(editor(page)).toHaveValue('我想喝咖啡然后去医院看医生');
    await expect(candidateList(page)).toHaveCount(0);
  });
});

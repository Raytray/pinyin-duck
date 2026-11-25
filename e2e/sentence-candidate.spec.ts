import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixtures.js';
import { candidateItems, candidateList, editor, expectBuffer, expectNoMatches, gotoApp } from './helpers';
import {
  candidateDetail,
  detailWordSections,
  expectSentenceRow,
  sentenceHanzi,
  sentenceWords,
  wordMenu,
  wordMenuAlternatives,
} from './sentence-helpers';

// A Sentence candidate's row draws each word as its own block (pinyin over Hanzi over a
// one-sense gloss), and a partial one ends with its leftover pinyin marked "next".
// Committing takes exactly what the candidate covers. The decision is #31; ranking is #30.
// The word menu swaps one word for an alternative (a Fixed word) or commits through it (#37).

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

  test('a click on the leftover block commits the covered words, leftover still composing', async ({ page }) => {
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

const HE_ALTERNATIVES = ['和', '喝', '河', '合', '吓', '呵', '贺', '何', '盒'];

/** Opens the menu of word `n` (from 0) of the highlighted sentence with Shift+→. */
async function openWordMenu(page: Page, n: number) {
  for (let i = 0; i <= n; i++) await editor(page).press('Shift+ArrowRight');
}

test.describe('the word menu', () => {
  test('Shift+→ walks a word cursor across the blocks, opening each block\'s menu', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);

    await editor(page).press('Shift+ArrowRight');
    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 我');
    await expect(sentenceWords(sentenceRow(page)).nth(0)).toHaveAttribute('aria-expanded', 'true');

    await editor(page).press('Shift+ArrowRight');
    await editor(page).press('Shift+ArrowRight');
    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 喝');
    await expect(sentenceWords(sentenceRow(page)).nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(sentenceWords(sentenceRow(page)).nth(2)).toHaveAttribute('aria-expanded', 'true');
    // Numbered alternatives from the span-alternatives query, then "Commit through".
    await expect(wordMenuAlternatives(page).locator('.word-menu-hanzi')).toHaveText(HE_ALTERNATIVES);
    await expect(wordMenuAlternatives(page).locator('kbd')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    await expect(wordMenu(page).getByRole('menuitem').last()).toHaveText(/Commit through 喝$/);
    await expect(editor(page)).toBeFocused();
  });

  test('a digit swaps 和 for 喝 in place and the sentence rebuilds around it', async ({ page }) => {
    await editor(page).pressSequentially('woxiangheta');
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '他']);
    await openWordMenu(page, 2);

    await editor(page).press('2');

    await expect(wordMenu(page)).toHaveCount(0);
    // 喝 is fixed on its span; its neighbour is chosen again around it.
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '喝', '太']);
    await expect(sentenceWords(sentenceRow(page)).nth(2)).toHaveClass(/\bfixed\b/);
    await expect(sentenceRow(page)).toHaveAttribute('aria-selected', 'true');
  });

  test('Space commits the whole edited sentence', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);
    await editor(page).press('1');
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '咖啡']);

    await editor(page).press(' ');

    await expect(editor(page)).toHaveValue('我想和咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });

  test('Space with the menu open commits the whole sentence too', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 1);

    await editor(page).press(' ');

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });

  test('Enter commits through the word and the rest composes again', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 1);

    await editor(page).press('Enter');

    await expect(editor(page)).toHaveValue('我想');
    await expectBuffer(page, 'hekafei');
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['喝', '咖啡']);
    await expect(wordMenu(page)).toHaveCount(0);
  });

  test('commit-through takes a separator after the word with it', async ({ page }) => {
    await editor(page).pressSequentially("woxiang'hekafei");
    await openWordMenu(page, 1);

    await editor(page).press('Enter');

    await expect(editor(page)).toHaveValue('我想');
    await expectBuffer(page, 'hekafei');
  });

  test('Esc closes the menu and keeps composing; a second Esc cancels', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);

    await editor(page).press('Escape');

    await expect(wordMenu(page)).toHaveCount(0);
    await expectBuffer(page, FULL);
    await editor(page).press('Escape');
    await expect(candidateList(page)).toHaveCount(0);
    await expect(editor(page)).toHaveValue('');
  });

  test('Shift past either end closes the menu', async ({ page }) => {
    await editor(page).pressSequentially(FULL);

    await editor(page).press('Shift+ArrowRight');
    await editor(page).press('Shift+ArrowLeft');
    await expect(wordMenu(page)).toHaveCount(0);

    // From closed, Shift+← starts at the last word.
    await editor(page).press('Shift+ArrowLeft');
    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 咖啡');
    await editor(page).press('Shift+ArrowRight');
    await expect(wordMenu(page)).toHaveCount(0);
    await expectBuffer(page, FULL);
  });

  test('clicking a word block opens its menu, and a click on an alternative swaps it', async ({ page }) => {
    await editor(page).pressSequentially(FULL);

    await sentenceWords(sentenceRow(page)).nth(2).click();

    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 喝');
    await expect(editor(page)).toHaveValue('');
    await expect(editor(page)).toBeFocused();

    await wordMenuAlternatives(page).nth(0).click();
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '咖啡']);
    await expect(editor(page)).toBeFocused();
  });

  test('clicking "Commit through" commits through that word', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await sentenceWords(sentenceRow(page)).nth(0).click();

    await wordMenu(page).getByRole('menuitem', { name: /Commit through 我/ }).click();

    await expect(editor(page)).toHaveValue('我');
    await expectBuffer(page, 'xianghekafei');
  });

  test('clicking the candidate number commits the whole sentence', async ({ page }) => {
    await editor(page).pressSequentially(FULL);

    await sentenceRow(page).locator('.candidate-num').click();

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });

  test('clicking the gap between blocks commits the whole sentence', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    const first = (await sentenceWords(sentenceRow(page)).nth(0).boundingBox())!;
    const second = (await sentenceWords(sentenceRow(page)).nth(1).boundingBox())!;
    expect(second.x).toBeGreaterThan(first.x + first.width);

    await page.mouse.click((first.x + first.width + second.x) / 2, first.y + first.height / 2);

    await expect(editor(page)).toHaveValue('我想喝咖啡');
    await expect(candidateList(page)).toHaveCount(0);
  });
});

test.describe('Fixed words', () => {
  test('last while the learner keeps composing', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);
    await editor(page).press('1');

    await editor(page).pressSequentially('qqq');

    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '咖啡']);
    await expect(sentenceRow(page).locator('.sentence-leftover-pinyin')).toHaveText('qqq');
  });

  test('are dropped when a Backspace reaches into their span', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);
    await editor(page).press('1');

    // Deleting `kafei` leaves 和 whole.
    for (let i = 0; i < 5; i++) await editor(page).press('Backspace');
    await expect(sentenceWords(sentenceRow(page)).nth(2)).toHaveClass(/\bfixed\b/);
    // One more reaches into it.
    await editor(page).press('Backspace');
    await editor(page).pressSequentially('ekafei');

    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);
  });

  test('are dropped on commit', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);
    await editor(page).press('1');
    await editor(page).press(' ');
    await expect(editor(page)).toHaveValue('我想和咖啡');

    await editor(page).pressSequentially(FULL);

    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);
  });

  test('are dropped on Esc', async ({ page }) => {
    await editor(page).pressSequentially(FULL);
    await openWordMenu(page, 2);
    await editor(page).press('1');
    await editor(page).press('Escape');
    await expect(candidateList(page)).toHaveCount(0);

    await editor(page).pressSequentially(FULL);

    await expectSentenceRow(sentenceRow(page), COFFEE_WORDS);
  });

  test('a fixed completed last word follows the learner typing the rest of it', async ({ page }) => {
    await editor(page).pressSequentially('woxianghekafe');
    await editor(page).press('Shift+ArrowLeft');
    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 咖啡');
    await expect(wordMenuAlternatives(page).nth(1).locator('.word-menu-hanzi')).toHaveText('咖啡馆');

    await editor(page).press('2');
    await expect(sentenceHanzi(sentenceRow(page)).last()).toHaveText('咖啡馆');

    // Unfixed, `woxianghekafeiguan` reads 咖啡 + 罐.
    await editor(page).pressSequentially('iguan');
    await expect(sentenceHanzi(sentenceRow(page)).last()).toHaveText('咖啡馆');
    await editor(page).pressSequentially('ma');
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '咖啡馆', '吗']);
  });
});

test.describe('the word menu on a partial sentence', () => {
  test('works the same, and the leftover block has no menu', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);

    await openWordMenu(page, 3);
    await expect(wordMenu(page)).toHaveAccessibleName('Alternatives for 咖啡');
    // Past 咖啡 is the leftover, which is not a word: the menu closes.
    await editor(page).press('Shift+ArrowRight');
    await expect(wordMenu(page)).toHaveCount(0);

    await openWordMenu(page, 1);
    await editor(page).press('Enter');
    await expect(editor(page)).toHaveValue('我想');
    await expectBuffer(page, 'hekafeiqqq');
    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['喝', '咖啡']);
  });

  test('a swap keeps the leftover composing next', async ({ page }) => {
    await editor(page).pressSequentially(PARTIAL);
    await openWordMenu(page, 2);

    await editor(page).press('1');

    await expect(sentenceHanzi(sentenceRow(page))).toHaveText(['我', '想', '和', '咖啡']);
    await expect(sentenceRow(page).locator('.sentence-leftover-pinyin')).toHaveText('qqq');
    await editor(page).press(' ');
    await expect(editor(page)).toHaveValue('我想和咖啡');
    await expectNoMatches(page, 'qqq');
  });
});

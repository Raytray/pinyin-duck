import { test, expect } from './coverage-fixtures.js';
import {
  editor,
  candidateList,
  pageCounter,
  candidateItems,
  gotoApp,
  expectCandidates,
  expectPinyin,
  expectGlosses,
  textLength,
  expectBuffer,
  expectNoMatches,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('loads the shell with an idle, empty editor', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'PinyinDuck' })).toBeVisible();
  await expect(page.getByText('Pinyin input for Mandarin learners')).toBeVisible();
  await expect(editor(page)).toHaveValue('');
  await expect(page.locator('.empty-placeholder-layer')).toContainText('Start typing Pinyin here');
  await expect(page.locator('.status-item').first()).toContainText('Active (Ready to type)');
  await expect(textLength(page)).toContainText('Length: 0 characters');
  await expect(candidateList(page)).toHaveCount(0);
});

test('shows ranked candidates with pinyin and glosses while composing', async ({ page }) => {
  await editor(page).pressSequentially('nihao');

  await expectBuffer(page, 'nihao');
  // The exact two-syllable match outranks the far more frequent single character 你.
  await expectCandidates(page, ['你好', '你', '呢', '尼', '妮']);
  await expectPinyin(page, ['nǐ hǎo', 'nǐ', 'ní', 'ní', 'nī']);
  await expectGlosses(page, [
    'hello; hi',
    // 你 stands for both 你 and 妳 in simplified script, so its gloss joins the first sense
    // of each (ADR 0001).
    'you (informal, as opposed to courteous 您) / you (Note: In Taiwan…',
    'dense wool fabric (used for coats and jackets)',
    'Buddhist nun / (often used in phonetic spellings)',
    'girl / phonetic "ni" (in female names) / Taiwan pr.',
  ]);
  // 38 readings match "nihao" across the dictionary, which is 8 pages at a size of 5.
  await expect(pageCounter(page)).toHaveText('1 / 8');
  await expect(candidateItems(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.status-item').first()).toContainText('Composing Pinyin...');
  // The buffer is not committed text yet.
  await expect(editor(page)).toHaveValue('');
});

test('narrows candidates as more pinyin is typed', async ({ page }) => {
  await editor(page).pressSequentially('n');
  await expectBuffer(page, 'n');
  await expectCandidates(page, ['你', '那', '呢', '能', '哪']);

  await editor(page).pressSequentially('ih');
  await expectBuffer(page, 'nih');
  // Words that complete the query come before ones that leave pinyin to compose (issue #30).
  await expectCandidates(page, ['你好', '霓虹灯', '泥孩', '拟合', '尼赫鲁']);

  await editor(page).pressSequentially('ao');
  await expectBuffer(page, 'nihao');
  await expectCandidates(page, ['你好', '你', '呢', '尼', '妮']);
});

test('normalises uppercase input to a toneless buffer', async ({ page }) => {
  await editor(page).pressSequentially('NiHao');

  await expectBuffer(page, 'nihao');
  await expectCandidates(page, ['你好', '你', '呢', '尼', '妮']);
});

test('commits the first candidate on Space', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('你好');
  await expect(candidateList(page)).toHaveCount(0);
  await expect(textLength(page)).toContainText('Length: 2 characters');
});

test('commits a candidate chosen by number key', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '十', '使', '试', '诗']);

  await editor(page).press('2');

  await expect(editor(page)).toHaveValue('十');
  await expect(candidateList(page)).toHaveCount(0);
});

test('commits a candidate chosen by clicking the card', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '十', '使', '试', '诗']);

  await candidateItems(page).nth(2).click();

  await expect(editor(page)).toHaveValue('使');
});

test('commits the raw pinyin on Enter without translating it', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press('Enter');

  await expect(editor(page)).toHaveValue('nihao');
  await expect(candidateList(page)).toHaveCount(0);
});

test('Backspace deletes one buffer letter at a time', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await expectBuffer(page, 'nihao');

  await editor(page).press('Backspace');
  await expectBuffer(page, 'niha');
  await expect(candidateList(page)).toBeVisible();

  await editor(page).press('Backspace');
  await expectBuffer(page, 'nih');
});

test('Escape cancels composition and discards the buffer', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press('Escape');

  await expect(candidateList(page)).toHaveCount(0);
  await expect(editor(page)).toHaveValue('');
  await expect(page.locator('.empty-placeholder-layer')).toBeVisible();
});

test('shows the no-match state for unresolvable pinyin', async ({ page }) => {
  await editor(page).pressSequentially('qqq');

  await expectNoMatches(page, 'qqq');
  await expect(candidateItems(page)).toHaveCount(0);
});

test('Enter falls back to raw text when there are no candidates', async ({ page }) => {
  await editor(page).pressSequentially('qqq');
  await editor(page).press('Enter');

  await expect(editor(page)).toHaveValue('qqq');
});

test('Space falls back to raw text when there are no candidates', async ({ page }) => {
  // Space commits the highlighted candidate, but with an empty list there is nothing
  // to commit, so the buffered pinyin is inserted as plain text instead of being lost.
  await editor(page).pressSequentially('qqq');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('qqq');
  await expect(candidateList(page)).toHaveCount(0);
});

test('composes, commits, and resumes typing at the end of the text', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');
  await editor(page).pressSequentially('xiexie');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('你好谢谢');
  await expect(textLength(page)).toContainText('Length: 4 characters');
});

test('inserts a newline on Enter when not composing', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');
  await editor(page).press('Enter');

  await expect(editor(page)).toHaveValue('你好\n');
});

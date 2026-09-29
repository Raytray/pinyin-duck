import { test, expect } from '@playwright/test';
import {
  editor,
  candidateList,
  candidateItems,
  gotoApp,
  expectCandidates,
  expectPinyin,
  expectGlosses,
  expectBuffer,
  expectNoMatches,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('loads the shell with an idle, empty editor', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'PinyinDuck' })).toBeVisible();
  await expect(page.getByText('TypeDuck for Mandarin Learners')).toBeVisible();
  await expect(editor(page)).toHaveValue('');
  await expect(page.locator('.empty-placeholder-layer')).toContainText('Start typing Pinyin here');
  await expect(page.locator('.status-item').first()).toContainText('Active (Ready to type)');
  await expect(page.locator('.status-item').nth(1)).toContainText('Length: 0 characters');
  await expect(candidateList(page)).toHaveCount(0);
});

test('shows ranked candidates with pinyin and glosses while composing', async ({ page }) => {
  await editor(page).pressSequentially('nihao');

  await expectBuffer(page, 'nihao');
  await expectCandidates(page, ['你好', '你']);
  await expectPinyin(page, ['nǐ hǎo', 'nǐ']);
  await expectGlosses(page, ['hello / how are you', 'you (singular)']);
  await expect(page.locator('.candidate-count-tag')).toHaveText('1 / 1');
  await expect(candidateItems(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.status-item').first()).toContainText('Composing Pinyin...');
  // The buffer is not committed text yet.
  await expect(editor(page)).toHaveValue('');
});

test('narrows candidates as more pinyin is typed', async ({ page }) => {
  await editor(page).pressSequentially('n');
  await expectBuffer(page, 'n');
  await expectCandidates(page, ['你', '你好', '你们']);

  await editor(page).pressSequentially('ih');
  await expectBuffer(page, 'nih');
  await expectCandidates(page, ['你好', '你']);

  await editor(page).pressSequentially('ao');
  await expectBuffer(page, 'nihao');
  await expectCandidates(page, ['你好', '你']);
});

test('normalises uppercase input to a toneless buffer', async ({ page }) => {
  await editor(page).pressSequentially('NiHao');

  await expectBuffer(page, 'nihao');
  await expectCandidates(page, ['你好', '你']);
});

test('commits the first candidate on Space', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('你好');
  await expect(candidateList(page)).toHaveCount(0);
  await expect(page.locator('.status-item').nth(1)).toContainText('Length: 2 characters');
});

test('commits a candidate chosen by number key', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '时', '十', '事']);

  await editor(page).press('3');

  await expect(editor(page)).toHaveValue('十');
  await expect(candidateList(page)).toHaveCount(0);
});

test('commits a candidate chosen by clicking the card', async ({ page }) => {
  await editor(page).pressSequentially('shi');
  await expectCandidates(page, ['是', '时', '十', '事']);

  await candidateItems(page).nth(2).click();

  await expect(editor(page)).toHaveValue('十');
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

test('composes, commits, and resumes typing at the end of the text', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');
  await editor(page).pressSequentially('xiexie');
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('你好谢谢');
  await expect(page.locator('.status-item').nth(1)).toContainText('Length: 4 characters');
});

test('inserts a newline on Enter when not composing', async ({ page }) => {
  await editor(page).pressSequentially('nihao');
  await editor(page).press(' ');
  await editor(page).press('Enter');

  await expect(editor(page)).toHaveValue('你好\n');
});

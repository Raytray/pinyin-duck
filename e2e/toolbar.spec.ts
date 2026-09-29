import { test, expect } from '@playwright/test';
import {
  editor,
  candidateList,
  scriptToggle,
  clearButton,
  copyButton,
  gotoApp,
  expectCandidates,
  expectGlosses,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test('starts in simplified script', async ({ page }) => {
  await expect(scriptToggle(page)).toContainText('简体 (Simplified)');

  await editor(page).pressSequentially('xiexie');
  await expectCandidates(page, ['谢谢']);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('谢谢');
});

test('renders traditional characters after the script toggle', async ({ page }) => {
  await scriptToggle(page).click();
  await expect(scriptToggle(page)).toContainText('繁體 (Traditional)');

  await editor(page).pressSequentially('xiexie');
  await expectCandidates(page, ['謝謝']);
  await expectGlosses(page, ['thank you / thanks']);
  await editor(page).press(' ');

  await expect(editor(page)).toHaveValue('謝謝');
});

test('toggles back to simplified without losing the composition buffer', async ({ page }) => {
  await scriptToggle(page).click();

  await editor(page).pressSequentially('zaijian');
  await expectCandidates(page, ['再見', '在']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');

  await scriptToggle(page).click();
  await expectCandidates(page, ['再见', '在']);
  await expect(page.locator('.candidate-buffer-text')).toHaveText('zaijian');
});

test('toggles script for a character that differs between the two scripts', async ({ page }) => {
  await editor(page).pressSequentially('zhongguo');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国');

  await editor(page).pressSequentially('beijing');
  await editor(page).press(' ');
  await expect(editor(page)).toHaveValue('中国北京');

  // Committed text is not rewritten; only new candidates change script.
  await expect(editor(page)).toHaveValue('中国北京');
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
  await expect(page.locator('.status-item').nth(1)).toContainText('Length: 0 characters');
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

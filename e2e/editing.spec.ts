import { test, expect } from './coverage-fixtures.js';
import { editor, gotoApp, textLength, expectBuffer } from './helpers';

/**
 * Editing behaviour on already-committed text. These paths never run while a
 * composition is active, so they are easy to regress without noticing: the keys keep
 * working, but quietly stop doing anything sensible.
 */

/**
 * Reads the editor once, with no retry.
 *
 * Every key is handled synchronously, so the value is final once the key press returns.
 * The candidate commits below still use `expect(editor).toHaveValue(...)`, which also
 * holds and reads the same either way.
 */
const editorValue = async (page: import('@playwright/test').Page) =>
  (await editor(page).inputValue());

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await editor(page).fill('abcd');
});

test('Backspace deletes the character before the cursor', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).press('Backspace');
  expect(await editorValue(page)).toBe('abc');
  await expect(textLength(page)).toContainText('Length: 3 characters');
});

test('Backspace deletes a selected range', async ({ page }) => {
  await editor(page).press('Home');
  await editor(page).press('Shift+End');
  await editor(page).press('Backspace');
  expect(await editorValue(page)).toBe('');
});

test('Delete removes the character after the cursor', async ({ page }) => {
  await editor(page).press('Home');
  await editor(page).press('Delete');
  expect(await editorValue(page)).toBe('bcd');
});

test('Delete removes a selected range', async ({ page }) => {
  await editor(page).press('Home');
  await editor(page).press('Shift+End');
  await editor(page).press('Delete');
  expect(await editorValue(page)).toBe('');
});

test('Backspace on empty text is a no-op', async ({ page }) => {
  await editor(page).press('Control+a');
  await editor(page).press('Backspace');
  expect(await editorValue(page)).toBe('');
  await expect(textLength(page)).toContainText('Length: 0 characters');
});

test('Enter inserts a newline into committed text', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).press('Enter');
  expect(await editorValue(page)).toBe('abcd\n');

  // A newline is accepted text, not a composition, so the next key still starts a
  // fresh composition rather than appending to the previous buffer.
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');
});

test('typing a letter over a selection replaces it with a composition', async ({ page }) => {
  await editor(page).press('Home');
  await editor(page).press('Shift+End');
  await editor(page).pressSequentially('n');

  // The selected range is consumed, not overwritten by the literal letter.
  await expectBuffer(page, 'n');
  await editor(page).press('Escape');
  expect(await editorValue(page)).toBe('');
});

test('a comma commits the current candidate and appends a full-width comma', async ({
  page,
}) => {
  await editor(page).press('End');
  await editor(page).pressSequentially('ni');
  await editor(page).press(',');

  // 你 is the top candidate for "ni", and "," maps to "，".
  await expect(editor(page)).toHaveValue('abcd你，');
  await expect(textLength(page)).toContainText('Length: 6 characters');
});

test('a comma with no candidates commits the raw buffer', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).pressSequentially('qqqq');
  await editor(page).press('.');

  await expect(editor(page)).toHaveValue('abcdqqqq。');
});

test('a comma in committed text inserts the full-width form', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).press(',');
  expect(await editorValue(page)).toBe('abcd，');
});

test('a digit in committed text is ignored rather than starting a composition', async ({
  page,
}) => {
  await editor(page).press('End');
  await editor(page).press('4');
  // Plain number input is left to the textarea, and no composition begins, so the
  // candidate popup stays closed.
  await expect(page.getByRole('listbox', { name: 'Pinyin Candidates' })).toHaveCount(0);
  expect(await editorValue(page)).toBe('abcd4');
});

test('Space inserts a space into committed text', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).press(' ');
  expect(await editorValue(page)).toBe('abcd ');
});

test('Control+A selects the committed text without typing a literal "a"', async ({ page }) => {
  await editor(page).press('Control+a');
  await editor(page).press('Backspace');
  expect(await editorValue(page)).toBe('');
});

test('Control+A during a composition cancels it and selects committed text', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');

  await editor(page).press('Control+a');
  // The pinyin buffer is discarded rather than committed.
  await expectBuffer(page, '').catch(() => {});

  await editor(page).press('Backspace');
  expect(await editorValue(page)).toBe('');
});

test('Escape during a composition cancels it but leaves committed text alone', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');

  await editor(page).press('Escape');
  expect(await editorValue(page)).toBe('abcd');
});

test('Control+X cuts the selected text to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor(page).press('Home');
  await editor(page).press('Shift+ArrowRight');
  await editor(page).press('Control+x');

  expect(await editorValue(page)).toBe('bcd');
  expect(await editor(page).evaluate(() => navigator.clipboard.readText())).toBe('a');
});

test('an unhandled modifier shortcut is neither prevented nor inserted as text', async ({
  page,
}) => {
  // Control+Z has no binding in the hook. It must not be swallowed into the
  // composition buffer, and it must not be preventDefault-ed away.
  await editor(page).press('End');
  await editor(page).press('Control+z');
  // Chromium performs its own undo here, which is the point: the event reached it.
  expect(await editorValue(page)).not.toBe('abcdz');

  // An unbound modifier combination leaves the text untouched outright.
  await editor(page).fill('abcd');
  await editor(page).press('Control+i');
  expect(await editorValue(page)).toBe('abcd');
});

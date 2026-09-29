import { test, expect } from './coverage-fixtures.js';
import { editor, gotoApp, expectBuffer, candidateItems, candidateList } from './helpers';

/**
 * Where a committed candidate lands.
 *
 * The editor inserts at the caret rather than at the end of the text, and the caret is
 * live for the whole composition. These paths share a failure mode -- a commit resolving
 * after the DOM has moved on -- that keeps the text correct by accident and puts the
 * caret in the wrong place, or drops a character, so each case asserts the caret too.
 */

const caret = (page: import('@playwright/test').Page) =>
  editor(page).evaluate((el) => el.selectionStart);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await editor(page).fill('abcd');
});

test('a candidate click lands at the caret rather than the end of the text', async ({
  page,
}) => {
  await editor(page).press('Home');
  await editor(page).press('ArrowRight');
  await editor(page).press('ArrowRight');
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');
  await expect(candidateList(page)).toBeVisible();

  await candidateItems(page).first().click();

  await expect(editor(page)).toHaveValue('ab你cd');
  expect(await caret(page)).toBe(3);
});

test('a candidate click follows a caret moved during the composition', async ({ page }) => {
  await editor(page).press('End');
  await editor(page).press('ArrowLeft');
  await editor(page).press('ArrowLeft');
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');
  await expect(candidateList(page)).toBeVisible();

  // The user repositions the caret before picking, so the candidate belongs where the
  // caret now is rather than where the composition started.
  await editor(page).press('End');
  expect(await caret(page)).toBe(4);

  await candidateItems(page).first().click();

  await expect(editor(page)).toHaveValue('abcd你');
  expect(await caret(page)).toBe(5);
});

test('a digit pick lands at the caret rather than the end of the text', async ({ page }) => {
  await editor(page).press('Home');
  await editor(page).press('ArrowRight');
  await editor(page).press('ArrowRight');
  await editor(page).pressSequentially('ni');
  await expectBuffer(page, 'ni');
  await expect(candidateList(page)).toBeVisible();

  await editor(page).press('1');

  await expect(editor(page)).toHaveValue('ab你cd');
  expect(await caret(page)).toBe(3);
});

test('repeated digit picks do not drift away from the caret', async ({ page }) => {
  await editor(page).press('Home');
  for (const pinyin of ['ni', 'hao', 'shi']) {
    await editor(page).pressSequentially(pinyin);
    await expect(candidateList(page)).toBeVisible();
    await editor(page).press('1');
    await expect(candidateList(page)).toHaveCount(0);
  }

  // Every commit belongs directly after the last. An insert that is measured against a
  // position captured before its predecessor moved the caret lands between characters
  // instead of after them, and the error compounds with each one.
  await expect(editor(page)).toHaveValue('你好是abcd');
  expect(await caret(page)).toBe(3);
});

test('two commits made in quick succession both land, in order', async ({ page }) => {
  await editor(page).press('End');
  // No delay between the keys: the candidate list has not resolved when the second
  // commit key is pressed, so both land through the queue.
  await editor(page).pressSequentially('ni', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });
  await editor(page).pressSequentially('hao', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  await expect(editor(page)).toHaveValue('abcd你好');
  expect(await caret(page)).toBe(6);
});

test('a commit behind the caret leaves the caret where the user put it', async ({ page }) => {
  await editor(page).fill('abcdefghij');
  await editor(page).press('End');
  await editor(page).pressSequentially('ni', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  // Move the caret back while the first commit is still resolving. It lands where its
  // key was pressed, and must not drag the caret forward past the user's own text.
  await editor(page).press('Home', { delay: 0 });
  expect(await caret(page)).toBe(0);

  await editor(page).pressSequentially('hao', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  await expect(editor(page)).toHaveValue('好abcdefghij你');
  expect(await caret(page)).toBe(1);
});

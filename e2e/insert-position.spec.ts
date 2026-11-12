import { test, expect } from './coverage-fixtures.js';
import { editor, gotoApp, expectBuffer, candidateItems, candidateList } from './helpers';

/**
 * Where a committed candidate lands.
 *
 * The editor inserts at the caret rather than at the end of the text, and the caret is
 * live for the whole composition. A commit that splices at the wrong offset can keep the
 * text right by accident and still put the caret in the wrong place, so each case
 * asserts the caret too.
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

test('two commits typed without a pause both land, in order', async ({ page }) => {
  await editor(page).press('End');
  // No delay between the keys. Each commit lands in the key press that made it, so the
  // second composition starts from the text and caret the first one left.
  await editor(page).pressSequentially('ni', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });
  await editor(page).pressSequentially('hao', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  await expect(editor(page)).toHaveValue('abcd你好');
  expect(await caret(page)).toBe(6);
});

test('a commit after moving the caret back lands at the new caret', async ({ page }) => {
  await editor(page).fill('abcdefghij');
  await editor(page).press('End');
  await editor(page).pressSequentially('ni', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  // Move the caret back straight after the first commit. The second composition starts
  // there, and its commit must not land at, or drag the caret to, the first one's spot.
  await editor(page).press('Home', { delay: 0 });
  expect(await caret(page)).toBe(0);

  await editor(page).pressSequentially('hao', { delay: 0 });
  await editor(page).press(' ', { delay: 0 });

  await expect(editor(page)).toHaveValue('好abcdefghij你');
  expect(await caret(page)).toBe(1);
});

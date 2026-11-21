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

// Composing over a selection replaces it in place: the commit lands where the selection
// was, whichever way it is committed. Each case selects "bc" in "abcd" from the keyboard,
// as a user would, so the selection reaches the editor through its own event handlers.
type Page = import('@playwright/test').Page;

async function selectForward(page: Page) {
  await editor(page).press('Home');
  await editor(page).press('ArrowRight');
  await editor(page).press('Shift+ArrowRight');
  await editor(page).press('Shift+ArrowRight');
}

// The anchor is on the right, so the selection runs backwards from the caret.
async function selectBackward(page: Page) {
  await editor(page).press('End');
  await editor(page).press('ArrowLeft');
  await editor(page).press('Shift+ArrowLeft');
  await editor(page).press('Shift+ArrowLeft');
}

const commits: {
  name: string;
  commit: (page: Page) => Promise<void>;
  expected: string;
  caretAfter: number;
}[] = [
  { name: 'Space', commit: (page) => editor(page).press(' '), expected: 'a你d', caretAfter: 2 },
  { name: 'a digit', commit: (page) => editor(page).press('1'), expected: 'a你d', caretAfter: 2 },
  {
    name: 'punctuation',
    commit: (page) => editor(page).press(','),
    expected: 'a你，d',
    caretAfter: 3,
  },
  // Enter commits the pinyin as typed.
  {
    name: 'Enter',
    commit: (page) => editor(page).press('Enter'),
    expected: 'anid',
    caretAfter: 3,
  },
  {
    name: 'a candidate click',
    commit: (page) => candidateItems(page).first().click(),
    expected: 'a你d',
    caretAfter: 2,
  },
];

const cases = [
  ...commits.map((c) => ({ ...c, direction: 'a forward', select: selectForward })),
  { ...commits[0], direction: 'a backward', select: selectBackward },
];

for (const { name, commit, expected, caretAfter, direction, select } of cases) {
  test(`composing over ${direction} selection replaces it when ${name} commits`, async ({
    page,
  }) => {
    await select(page);
    const selection = await editor(page).evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    expect(selection).toEqual([1, 3]);

    await editor(page).pressSequentially('ni');
    await expectBuffer(page, 'ni');
    await expect(candidateList(page)).toBeVisible();
    // The selection is gone as soon as the composition starts, and the caret sits
    // where it began rather than at the end of the text.
    await expect(editor(page)).toHaveValue('ad');
    expect(await caret(page)).toBe(1);

    await commit(page);

    await expect(editor(page)).toHaveValue(expected);
    expect(await caret(page)).toBe(caretAfter);
  });
}

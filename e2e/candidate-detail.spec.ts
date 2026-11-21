import { readFileSync } from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import type { Page, Route } from '@playwright/test';
import { test, expect } from './coverage-fixtures.js';
import { BTreeDictionary } from '../packages/core/src/data/btree-dictionary';
import { LazyPinyinSearchEngine } from '../packages/core/src/index/lazy-search';
import { DetailFile, encodeDetailFile, type DetailRecord } from '../packages/core/src/detail/detail-codec';
import { candidateItems, editor, expectCandidates, gotoApp } from './helpers';

// The detail file: `/src/generated/detail.bin.gz` under the dev server, and a
// content-hashed `detail.bin-<hash>.gz` in a production build.
const DETAIL_ASSET = '**/detail.bin*.gz';

const PUBLIC_DIR = path.join(__dirname, '..', 'packages', 'web', 'public');

const detail = (page: Page) => page.getByRole('region', { name: 'Candidate detail' });
const infoButton = (page: Page, hanzi: string) => page.getByRole('button', { name: `Details for ${hanzi}` });
const senses = (page: Page) => detail(page).locator('.detail-sense');

/** Counts the requests for the detail file, letting each one through unless `handle` says otherwise. */
async function watchDetailRequests(page: Page, handle?: (route: Route, n: number) => Promise<void>) {
  const requests = { count: 0 };
  await page.route(DETAIL_ASSET, async (route) => {
    requests.count += 1;
    if (handle) await handle(route, requests.count);
    else await route.continue();
  });
  return requests;
}

/** Types `mao`, whose first candidates are 猫 māo then 毛 máo. */
async function composeMao(page: Page) {
  await editor(page).pressSequentially('mao');
  await expectCandidates(page, ['猫', '毛', '冒', '冇', '帽']);
}

test.describe('opening and closing', () => {
  test('Tab opens the detail of the highlighted candidate and closes it again', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);

    await editor(page).press('Tab');
    await expect(detail(page)).toBeVisible();
    await expect(senses(page).first()).toHaveText('cat (CL:只 zhī)');
    await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(editor(page)).toBeFocused();

    await editor(page).press('Tab');
    await expect(detail(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('');
  });

  test('the ⓘ button toggles the detail of its own row, without committing', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);

    await infoButton(page, '毛').click();
    await expect(candidateItems(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(senses(page).first()).toHaveText('hair');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveValue('');

    // Another row's ⓘ moves the detail there rather than closing it.
    await infoButton(page, '猫').click();
    await expect(candidateItems(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(senses(page).first()).toHaveText('cat (CL:只 zhī)');

    await infoButton(page, '猫').click();
    await expect(detail(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  });

  test('↑ and ↓ move the highlight and the detail follows', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await expect(senses(page).first()).toHaveText('cat (CL:只 zhī)');

    await editor(page).press('ArrowDown');
    await expect(candidateItems(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(detail(page)).toHaveCount(1);
    await expect(senses(page).first()).toHaveText('hair');

    await editor(page).press('ArrowUp');
    await expect(senses(page).first()).toHaveText('cat (CL:只 zhī)');
  });

  test('Esc closes the detail first, and a second Esc cancels the composition', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await expect(detail(page)).toBeVisible();

    await editor(page).press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await expect(candidateItems(page)).toHaveCount(5);

    await editor(page).press('Escape');
    await expect(candidateItems(page)).toHaveCount(0);
    await expect(editor(page)).toHaveValue('');
  });
});

test.describe('committing while the detail is open', () => {
  test('Space commits the highlighted candidate', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await editor(page).press('ArrowDown');
    await expect(senses(page).first()).toHaveText('hair');

    await editor(page).press(' ');
    await expect(editor(page)).toHaveValue('毛');
    await expect(detail(page)).toHaveCount(0);
  });

  test('a number key commits its candidate', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await expect(detail(page)).toBeVisible();

    await editor(page).press('3');
    await expect(editor(page)).toHaveValue('冒');
    await expect(detail(page)).toHaveCount(0);
  });

  test('clicking the large character commits it', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await editor(page).press('ArrowDown');

    await detail(page).getByRole('button', { name: 'Use 毛' }).click();
    await expect(editor(page)).toHaveValue('毛');
    await expect(detail(page)).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
  });

  test('the detail closes with its composition and stays closed for the next one', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');
    await editor(page).press(' ');
    await expect(editor(page)).toHaveValue('猫');

    await composeMao(page);
    await expect(detail(page)).toHaveCount(0);
  });
});

test.describe('what the detail shows', () => {
  test('the counterpart, numbered senses and measure words', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');

    await expect(detail(page).locator('.detail-reading')).toHaveText('māo');
    await expect(detail(page).locator('.detail-counterpart')).toHaveText('貓');
    await expect(senses(page)).toHaveText(['cat (CL:只 zhī)', '(dialect) to hide oneself', '(loanword) (coll.) modem']);
    await expect(detail(page).locator('.detail-senses')).toHaveJSProperty('tagName', 'OL');
    // The short gloss gives way to the senses once they are in.
    await expect(detail(page).locator('.detail-gloss')).toHaveCount(0);

    await editor(page).press('Escape');
    await editor(page).press('Escape');
    await editor(page).pressSequentially('hou');
    await expectCandidates(page, ['厚', '吼', '后', '猴', '候']);
    await infoButton(page, '猴').click();
    await expect(detail(page).locator('.detail-mw')).toHaveText('Measure words 只 zhī');
  });

  test('a candidate standing for several headwords shows a group for each, with its tags', async ({ page }) => {
    await gotoApp(page);
    await editor(page).pressSequentially('hou');
    await expectCandidates(page, ['厚', '吼', '后', '猴', '候']);
    await infoButton(page, '后').click();

    const groups = detail(page).locator('.detail-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.locator('.detail-heading')).toHaveText(['後', '后']);
    await expect(groups.nth(0).locator('.detail-sense').first()).toHaveText('back');
    await expect(groups.nth(1).locator('.detail-tag')).toHaveText(['Surname Hou']);
    await expect(groups.nth(1).locator('.detail-sense').first()).toHaveText('empress');
    // Senses are numbered within each group.
    await expect(groups.locator('ol')).toHaveCount(2);
    // Group headings stand in for the counterpart.
    await expect(detail(page).locator('.detail-counterpart')).toHaveCount(0);
  });

  test('the part-of-speech line, when the entry has one', async ({ page }) => {
    // Served from a detail file built here, so this does not depend on which entries
    // the part-of-speech data covers.
    const { buildId, entryCount, entryIdsOf } = openRealDictionary();
    const [catId] = entryIdsOf('mao', '猫');
    const records: DetailRecord[] = Array.from({ length: entryCount }, () => emptyRecord());
    records[catId] = {
      ...emptyRecord(),
      senses: [{ proper: false, text: ['cat'] }],
      partsOfSpeech: ['noun', 'verb'],
    };
    const body = gzipSync(encodeDetailFile(records, buildId));
    await page.route(DETAIL_ASSET, (route) => route.fulfill({ status: 200, body }));

    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');

    await expect(detail(page).locator('.detail-pos')).toHaveText('noun · verb');
    await expect(senses(page)).toHaveText(['cat']);
  });

  test('a long detail has a max height and scrolls on its own', async ({ page }) => {
    await gotoApp(page);
    await composeMao(page);
    await infoButton(page, '毛').click();
    await expect(senses(page).first()).toHaveText('hair');

    const box = await detail(page).evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      maxHeight: getComputedStyle(el).maxHeight,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(box.overflowY).toBe('auto');
    expect(box.maxHeight).not.toBe('none');
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);

    // Scrolling the detail scrolls it, not the page, and keeps the composition going.
    await detail(page).hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => detail(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(editor(page)).toBeFocused();
  });
});

test.describe('loading the detail file', () => {
  test('is fetched once, on the first expand, and held after', async ({ page }) => {
    const requests = await watchDetailRequests(page);
    await gotoApp(page);
    await composeMao(page);
    // The initial download does not include it.
    expect(requests.count).toBe(0);

    await editor(page).press('Tab');
    await expect(senses(page).first()).toHaveText('cat (CL:只 zhī)');
    await editor(page).press('ArrowDown');
    await editor(page).press('Tab');
    await editor(page).press('Tab');
    await expect(senses(page).first()).toHaveText('hair');
    await editor(page).press('Escape');
    await editor(page).press('Escape');

    await editor(page).pressSequentially('hou');
    await editor(page).press('Tab');
    await expect(senses(page).first()).toHaveText('thick');
    expect(requests.count).toBe(1);
  });

  test('while it is in flight, the detail shows the short gloss and waits on the one fetch', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = await watchDetailRequests(page, async (route) => {
      await gate;
      await route.continue();
    });
    await gotoApp(page);
    await composeMao(page);

    await editor(page).press('Tab');
    await expect(detail(page).getByRole('button', { name: 'Use 猫' })).toBeVisible();
    await expect(detail(page).locator('.detail-reading')).toHaveText('māo');
    await expect(detail(page).locator('.detail-gloss')).toContainText('cat (CL:隻|只)');
    await expect(detail(page)).toContainText('Loading details…');
    await expect(senses(page)).toHaveCount(0);

    // Another candidate waits on the same fetch.
    await editor(page).press('ArrowDown');
    await expect(detail(page).locator('.detail-gloss')).toHaveText('hair / feather / down');
    await expect(detail(page)).toContainText('Loading details…');
    await editor(page).press('Tab');
    await editor(page).press('Tab');
    expect(requests.count).toBe(1);

    release();
    await expect(senses(page).first()).toHaveText('hair');
    await expect(detail(page)).not.toContainText('Loading details…');
    expect(requests.count).toBe(1);
  });

  test('an HTTP error keeps the short gloss, offers no retry, and the next expand tries again', async ({ page }) => {
    const requests = await watchDetailRequests(page, async (route, n) => {
      if (n === 1) await route.fulfill({ status: 404, body: 'Not Found' });
      else await route.continue();
    });
    await gotoApp(page);
    await composeMao(page);

    await editor(page).press('Tab');
    await expect(detail(page)).toContainText("Couldn't load details");
    await expect(detail(page).locator('.detail-gloss')).toContainText('cat (CL:隻|只)');
    await expect(detail(page).getByRole('button')).toHaveText(['猫']);
    await expect(detail(page)).not.toContainText('Loading details…');

    // Moving the highlight shows the failure for that candidate too, without fetching again.
    await editor(page).press('ArrowDown');
    await expect(detail(page)).toContainText("Couldn't load details");
    expect(requests.count).toBe(1);

    await editor(page).press('Tab');
    await editor(page).press('Tab');
    await expect(senses(page).first()).toHaveText('hair');
    expect(requests.count).toBe(2);
  });

  test('a detail file from another build is a failed load', async ({ page }) => {
    const { buildId, entryCount } = openRealDictionary();
    const records: DetailRecord[] = Array.from({ length: entryCount }, () => emptyRecord());
    const body = gzipSync(encodeDetailFile(records, (buildId + 1) >>> 0));
    await page.route(DETAIL_ASSET, (route) => route.fulfill({ status: 200, body }));

    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');

    await expect(detail(page)).toContainText("Couldn't load details");
    await expect(detail(page).locator('.detail-gloss')).toContainText('cat (CL:隻|只)');
    await expect(senses(page)).toHaveCount(0);
  });

  test('being offline is a failed load', async ({ page }) => {
    await page.route(DETAIL_ASSET, (route) => route.abort('internetdisconnected'));

    await gotoApp(page);
    await composeMao(page);
    await editor(page).press('Tab');

    await expect(detail(page)).toContainText("Couldn't load details");
    await expect(detail(page).locator('.detail-gloss')).toContainText('cat (CL:隻|只)');
  });
});

function emptyRecord(): DetailRecord {
  return { heading: '', senses: [], tags: [], measureWords: [], partsOfSpeech: [] };
}

/** The built dictionary and detail file, for making detail files that match its build. */
function openRealDictionary() {
  const dictionary = BTreeDictionary.open(new Uint8Array(readFileSync(path.join(PUBLIC_DIR, 'dictionary.btree'))));
  const realDetail = DetailFile.open(
    new Uint8Array(readFileSync(path.join(PUBLIC_DIR, 'detail.bin'))),
    dictionary.buildId
  );
  const engine = new LazyPinyinSearchEngine(dictionary);
  return {
    buildId: dictionary.buildId,
    entryCount: realDetail.entryCount,
    entryIdsOf(query: string, hanzi: string): number[] {
      const candidate = engine.search(query, { limit: 10 }).candidates.find((c) => c.hanzi === hanzi);
      if (!candidate) throw new Error(`no candidate ${hanzi} for ${query}`);
      return candidate.entryIds;
    },
  };
}

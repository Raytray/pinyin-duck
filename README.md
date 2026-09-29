# PinyinDuck 🦆

A TypeDuck-inspired Mandarin Pinyin input method designed for learners. As you type Pinyin, suggestions are shown with tone marks, frequency-weighted ranking, and concise English definitions so you never select the wrong character.

## Monorepo Packages

- **`packages/core`**: Pinyin syllable segmenter, CC-CEDICT indexer, Trie-based candidate search engine, and ranking algorithm.
- **`packages/web`**: Web application featuring an interactive IME composition playground with inline candidate definition cards.
- **`packages/windows`**: (Planned Milestone 2) Windows desktop integration.
- **`packages/android`**: (Planned Milestone 3) Android input method integration.

## Getting Started

```bash
npm install
npm run dev
```

## Typing Behavior

Type romanized pinyin into the editor and the candidate list re-ranks on every keystroke.
While a composition is active:

| Key | Action |
| --- | --- |
| `1`–`9` | Select the candidate in that position |
| `Space` | Commit the highlighted candidate |
| `Enter` | Commit the raw pinyin as English text |
| `Backspace` | Delete the last buffered letter, or the character before the cursor when not composing |
| `PageUp` / `PageDown`, `[` / `]` | Flip candidate pages |
| Arrow keys | Move the selection, rolling onto the next page at the end of a list |
| `Escape` | Cancel the composition |

### Number Keys Select Candidates

Number keys pick a candidate for the whole duration of a composition. They are never
appended to the pinyin buffer, so a number key does not type a tone number: typing `shi4`
selects candidate #4 rather than filtering to the fourth tone, and out-of-range digits
(and `0`) are simply ignored. Keeping digits on candidate selection means the key always
does the same predictable thing, instead of changing meaning depending on how many
candidates happen to be on screen.

Tone-number filtering still exists in `@pinyinduck/core` for direct callers — including
the planned Windows and Android clients — and is covered by the unit tests. Once no
composition is active, number keys are ordinary text input again.

## Testing

The repository has two test layers:

| Layer | Command | Covers |
| --- | --- | --- |
| Unit (`packages/core`) | `npm test` | Pinyin parsing, syllable segmentation, tone-mark conversion, trie search and ranking |
| End-to-end (Playwright) | `npm run test:e2e` | The full IME loop in a real browser: composition, candidate ranking, paging, keyboard shortcuts, script toggle |

Run both with `npm run test:all`.

The Playwright suite lives in `e2e/` and is configured by `playwright.config.ts` at the
repo root. It starts the Vite dev server automatically, so no server needs to be running
first. On first use, install the browser binary:

```bash
npx playwright install chromium
```

Useful variations:

```bash
npm run test:e2e -- --ui          # interactive debugger with time-travel
npm run test:e2e -- --headed      # watch the browser drive the IME
npm run test:e2e -- --grep paging # run one area
```

`CI=1` switches to a single worker with retries and emits a GitHub Actions friendly
report. Traces, screenshots and video are captured on first-retry failures only, and
`playwright-report/` holds the HTML report after a local run.

### Number key coverage

The number-while-composing behavior documented in [Number Keys Select Candidates](#number-keys-select-candidates)
is pinned by `e2e/number-keys.spec.ts`.


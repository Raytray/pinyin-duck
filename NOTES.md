# PinyinDuck - Session Notes & Handover Guide

## 1. Project State & Progress Summary

- **Repository**: `/home/raytray/repositories/pinyin-typeduck`
- **Architecture & Roadmap**: Fully specified in [`PLAN.md`](./PLAN.md).
- **Milestone 1 - Step 1 (Monorepo Setup)**: **Complete** (Git commit `chore: initialize monorepo workspace and git repository`).
- **Milestone 1 - Step 2 (`@pinyinduck/core`)**: **Implementation Complete**, ready for test run and commit.

---

## 2. Completed in Step 2 (`packages/core`)

All core architectural modules have been authored and organized:

1. **Shared Types** (`packages/core/src/types.ts`):
   - `DictEntry`, `Candidate`, `SearchOptions`, `SearchResult`, `ScriptType` ('simplified' | 'traditional').

2. **Pinyin Parser & Syllable Segmentation** (`packages/core/src/parser/pinyin.ts`):
   - Complete valid Mandarin syllable dictionary (400+ syllables).
   - `pinyinNumbersToMarks`: Accurate vowel tone mark placement rules (`ni3 hao3` &rarr; `nǐ hǎo`, `lü4` &rarr; `lǜ`).
   - `segmentPinyin`: Greedy forward-matching syllable segmenter supporting continuous toneless strings (`nihao` &rarr; `["ni", "hao"]`), tone numbers (`ni3hao3` &rarr; `["ni3", "hao3"]`), and apostrophes (`xi'an` &rarr; `["xi", "an"]`).
   - `cleanPinyin`: Strips numbers/punctuation for index matching.
   - Comprehensive unit tests: `packages/core/src/parser/pinyin.test.ts`.

3. **Candidate Gloss Formatter** (`packages/core/src/dictionary/gloss.ts`):
   - Sanitizes raw CC-CEDICT definition lists, removes classifier annotations (`CL:個|个[ge4]`) and internal tags.
   - Produces clean, readable candidate card summaries truncated to optimal width.

4. **Trie Prefix Search** (`packages/core/src/index/trie.ts`):
   - Fast prefix tree indexing `DictEntry` records by clean pinyin syllables and multi-character words.
   - Supports exact matches and prefix exploration.

5. **Search Engine & Candidate Ranking** (`packages/core/src/index/search.ts`):
   - Query parser with tone detection and syllable segmentation.
   - Multi-tier ranking formula:
     1. Exact tone match priority (e.g. typing `ta4` prioritizes `踏` over `他`).
     2. Exact full pinyin match > prefix matches.
     3. Word length boost (words prioritized over single characters for multi-syllable inputs).
     4. Frequency corpus scoring (everyday words like `他`, `她`, `它` rank ahead of archaic characters like `塌`).
     5. HSK level weighting.
     6. Script toggle (`simplified` vs `traditional`).
   - Unit tests: `packages/core/src/index/search.test.ts`.

6. **Seed & Offline Dictionary** (`packages/core/src/data/seed-dict.ts`):
   - Built-in seed dataset covering essential HSK 1-4 words and homophone pairs for instant out-of-the-box offline testing.
   - Build script: `packages/core/scripts/build-dictionary.ts` for processing full CC-CEDICT releases.

---

## 3. Environment & Shell Configuration

> [!IMPORTANT]
> The environment requires the user `raytray` with `zsh` and `nvm`:
> - **Shell**: `zsh`
> - **Node**: `v26.7.0` (managed via nvm)
> - **npm**: `12.0.2`
>
> When executing shell commands unsandboxed (`BypassSandbox: true`), invoke through:
> ```bash
> zsh -i -c '<command>'
> ```

---

## 4. How to Pick Up the Next Session

1. **Verify Unit Tests**:
   ```bash
   zsh -i -c 'npm test'
   ```
   (Runs vitest on `packages/core/src/**/*.test.ts`).

2. **Commit Step 2**:
   ```bash
   git add .
   git commit -m "feat(core): implement dictionary indexing, pinyin parser, and candidate search"
   ```

3. **Proceed to Step 3 (`@pinyinduck/web`)**:
   - Initialize Vite + React + TypeScript inside `packages/web`.
   - Build the IME composition hook `usePinyinDuck` managing raw buffer, candidate selection, and cursor state.
   - Build the candidate card dropdown UI displaying:
     - Candidate index (`1`–`9`)
     - Chinese characters (Simplified/Traditional)
     - Marked Pinyin (`nǐ hǎo`)
     - Clean English definitions
   - Connect the `@pinyinduck/core` engine with the offline dictionary.

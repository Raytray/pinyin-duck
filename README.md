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

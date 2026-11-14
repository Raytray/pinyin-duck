# Contributing to PinyinDuck

Thanks for your interest. Bug reports, suggestions and pull requests are all welcome.

## Before you write code

Open an issue first for anything beyond a small fix (a typo, a one-line bug, a broken
link). Describe what you want to change and why, and wait for a reply before starting.
This avoids work on a change that doesn't fit the project's direction, which is a
learner-first IME: candidates a learner can understand, ranked so the expected word comes
first.

Small fixes can go straight to a pull request.

## Reporting bugs

Include:

- the platform (web, Android, Windows or macOS) and its version
- the pinyin you typed
- the candidates you expected and the ones you got

Do not report security issues in a public issue. See [SECURITY.md](SECURITY.md).

## Setting up

See the [README](README.md) for prerequisites, the quick start, and per-package docs.
In short:

```bash
npm install
npm run build:dict && npm run build:rime
npm run dev
```

## Before opening a pull request

Run the checks for the packages you touched. Each package's `ci` script runs exactly what
its CI job runs:

```bash
npm run lint
npm run typecheck
npm run ci -w @pinyinduck/<core|web|android|rime>
npm run test:e2e        # if you changed the web app or core search
```

Then:

- Keep each pull request to one change. Split unrelated changes into separate PRs.
- Add or update tests for behavior you change.
- Write the commit and PR title as a short imperative sentence, e.g. "Rank HSK 1 words
  above rarer homophones".
- Explain in the PR description what changed and why, and link the issue it addresses.

## Licensing

Code contributions are accepted under the project's [MIT License](LICENSE). Changes to
the dictionary data or the built dictionary files fall under the licenses listed in
[DATA_LICENSES.md](DATA_LICENSES.md), including CC BY-SA 4.0 for the built dictionary.

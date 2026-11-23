# Issue tracker: Forgejo (homelab)

Issues and specs for this repo live as issues on the homelab Forgejo instance,
`git.tail68c66a.ts.net`, repo `raytray25/pinyin-duck`. Use the `gt` CLI (Gitea CLI v2, the
renamed `tea`), which is already logged in to that host. Don't use `fj` or `tea`. The `homelab` git
remote points at this repo; `origin` is the GitHub mirror and is **not** the tracker, so never use
`gh` for issues.

Every `gt` call needs `--remote homelab`; otherwise gt falls back to `origin`, which is on GitHub.
From outside the repo, pass `-R https://git.tail68c66a.ts.net/raytray25/pinyin-duck` instead.
Run gt with `</dev/null` in scripts so it never waits for input. An empty `-b`/`-F` on
`gt issue edit` clears the body, so check a fetched body isn't empty before writing it back.

## Conventions

- **Create an issue**: `gt issue create --remote homelab -t "<title>" -F <body-file> [-l <label>]...`.
  For a multi-line body, write it to a file (or pass `-F -` with a heredoc on stdin). Always give
  `-t` and a body, or gt opens an editor.
- **Read an issue**: `gt issue view <number> --remote homelab` (add `-c` for the comments).
  For a script, `--json body -q .body` prints the raw body.
- **List / search issues**: `gt issue list --remote homelab [-s open|closed|all] [-l <label>] [-S <query>]`.
- **Comment on an issue**: `gt issue comment <number> --remote homelab -b "<body>"` (or `-F <file>`).
- **Edit title / body**: `gt issue edit <number> --remote homelab -t "<title>"` / `-F <body-file>`.
- **Close**: `gt issue close <number> --remote homelab -c "<comment>"`.
- **Apply / remove labels**: `gt issue edit <number> --remote homelab --add-label <name>` /
  `--remove-label <name>`. The five triage labels and the `wayfinder:*` labels already exist on the repo.
- **Assign**: `gt issue edit <number> --remote homelab --add-assignee @me`.
- **Anything else**: `gt api <path>` makes an authenticated Forgejo API request.

Forgejo shares one number space across issues and PRs, so a bare `#42` may be either.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Forgejo issue as above.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Forgejo has native issue dependencies, and gt drives them, so blocking is real. Forgejo has no
sub-issues, so a ticket's link to its map stays in the text:

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: its own issue with `Part of #<map>` at the top of the body, and the map body
  carrying a task list of its children. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: native dependencies. `gt issue create ... --blocked-by <n>,<n>` when creating, or
  `gt issue edit <n> --remote homelab --add-blocked-by <n>,<n>` afterwards.
  `gt issue view <n> --remote homelab --json blocked_by` reads them. A ticket is unblocked when
  every issue blocking it is closed.
- **Frontier query**: list the map's open children
  (`gt issue list --remote homelab -S "Part of #<map>" --no-assignee`), drop the map itself and any with an open
  `blocked_by`; first in map order wins.
- **Claim**: `gt issue edit <n> --remote homelab --add-assignee @me`.
- **Resolve**: comment the answer, close the issue, then append a context pointer to the map's Decisions-so-far.

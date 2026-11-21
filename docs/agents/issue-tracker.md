# Issue tracker: Forgejo (homelab)

Issues and specs for this repo live as issues on the homelab Forgejo instance,
`git.tail68c66a.ts.net`, repo `raytray25/pinyin-duck`. Use the `fj` CLI (forgejo-cli); it is
already authenticated. The `homelab` git remote points at this repo; `origin` is the GitHub
mirror and is **not** the tracker, so never use `gh` for issues.

Every `fj` call needs the host and repo, because `origin` points at GitHub:
`fj -H git.tail68c66a.ts.net issue <cmd> -r raytray25/pinyin-duck ...`. Where a subcommand has no
`-r` (view, comment, close, edit), pass `-R homelab` to `fj issue` instead, which resolves the repo
from the `homelab` remote: `fj -H git.tail68c66a.ts.net issue -R homelab <cmd> ...`.

## Conventions

- **Create an issue**: `fj -H git.tail68c66a.ts.net issue create -r raytray25/pinyin-duck "<title>" --body "<body>"`. Use a heredoc via `--body "$(cat <<'EOF' ... EOF)"` for multi-line bodies. Omitting `--body` opens an editor, so always pass it.
- **Read an issue**: `fj -H git.tail68c66a.ts.net issue -R homelab view <number>` (body), `... view <number> comments` for the thread.
- **List / search issues**: `fj -H git.tail68c66a.ts.net issue search -r raytray25/pinyin-duck -s open [-l <label>] [<query>]`.
- **Comment on an issue**: `fj -H git.tail68c66a.ts.net issue -R homelab comment <number> "<body>"`
- **Edit title / body**: `fj ... issue -R homelab edit <number> title|body ...`
- **Close**: `fj -H git.tail68c66a.ts.net issue -R homelab close <number> -w "<comment>"`
- **Apply / remove labels**: `fj` has no label command. Use the Forgejo REST API
  (`https://git.tail68c66a.ts.net/api/v1/repos/raytray25/pinyin-duck/issues/<n>/labels`, `POST` to add,
  `DELETE .../labels/<label-id>` to remove) with an access token, or the web UI. The token `fj` is logged in with is in
  `~/.local/share/forgejo-cli/keys.json` (`hosts["git.tail68c66a.ts.net"].token`); send it as
  `Authorization: token <t>` and never print it. The five triage labels already exist on the repo.

Forgejo shares one number space across issues and PRs, so a bare `#42` may be either.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Forgejo issue as above.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Forgejo issues have no sub-issue or `gh`-style dependency CLI, so `/wayfinder` uses the plain-text
fallbacks:

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: its own issue with `Part of #<map>` at the top of the body, and the map body
  carrying a task list of its children. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked
  when every listed blocker is closed.
- **Frontier query**: list the map's open children, drop any whose `Blocked by` line names an open
  issue, or that is assigned; first in map order wins.
- **Claim**: assign the issue to the driving dev (web UI or API; `fj` cannot assign).
- **Resolve**: comment the answer, close the issue, then append a context pointer to the map's Decisions-so-far.

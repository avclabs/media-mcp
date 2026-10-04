# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues for `avclabs/media-mcp`. Use the `gh` CLI for tracker operations.

## Conventions

Run commands inside this clone so `gh` infers the repo from its Git remote. When operating outside the clone, pass `--repo avclabs/media-mcp` to commands that support it.

- **Create an issue**: `gh issue create --title "..." --body-file <body-file>`.
- **Read an issue**: `gh issue view <number> --comments`; use `--json number,title,body,labels,comments` when structured content is needed.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments`, with the relevant `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body-file <body-file>`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close an issue**: `gh issue close <number>`. Add any explanation as a comment first.

For multiline bodies and comments, write the exact text to a temporary file and pass it with `--body-file`. Preserve actual newlines and literal text.

Use the role mapping in `docs/agents/triage-labels.md` for triage labels.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When this flag is explicitly changed to `yes`, external PRs can use the same labels and states as issues, with the corresponding `gh pr` commands. Treat `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, and `NONE` author associations as external, excluding `OWNER`, `MEMBER`, and `COLLABORATOR`.

GitHub shares an issue/PR number space. When a bare number is ambiguous, resolve whether it is a PR before choosing the operation.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `avclabs/media-mcp`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `wayfinder`. The map is one issue with child issues as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding Notes / Decisions-so-far / Fog.
- **Child ticket**: link it to the map as a GitHub sub-issue. If unavailable, use a task list in the map and a `Part of #<map>` line in the child. Use `wayfinder:<type>` labels for research, prototype, grilling, or task.
- **Blocking**: use native GitHub issue dependencies when available. Otherwise, record `Blocked by: #<n>, #<n>` in the child. A ticket is unblocked only when every blocker is closed.
- **Frontier**: inspect the map's open children in map order; select the first with no open blockers and no assignee.
- **Claim**: `gh issue edit <number> --add-assignee @me`.
- **Resolve**: comment with the outcome, close the child, and append a concise decision and reference link to the map.

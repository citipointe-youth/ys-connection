---
name: ship
description: Ship/deploy/release a YS Connection branch to master and Vercel with one command.
---
On "ship", "deploy" or "release" a branch:
1. From a clean worktree on that branch run `bash scripts/ship.sh <branch>` (add `--promote` only if the user asked to promote and the vercel CLI is authed).
2. Report its last 5 lines, nothing else.
3. If it says "awaiting promote" or "promote via Vercel" and the user asked to promote, use the Vercel MCP `request_promote` tool on that deployment (find it by the printed sha/url). Then edit the `promote:` line in DEPLOY.md.
Never run the steps (tests, merge, push, promote) by hand; if the script fails, report the failure and stop.
State lives in `DEPLOY.md`.

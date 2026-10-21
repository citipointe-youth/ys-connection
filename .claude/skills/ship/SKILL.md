---
name: ship
description: Ship/deploy/release a YS Connection branch to master and Vercel with one command.
---
On "ship", "deploy" or "release" a branch:
0. Restart/ship blocked only Friday 17:30-20:00 and Sunday 10:00-12:00 (site time, Brisbane); any other time is fine. ship.sh has no gate for this, so check the clock yourself and do not ship or promote inside those windows unless the user overrides.
1. From a clean worktree on that branch run `bash scripts/ship.sh <branch>` (add `--promote` only if the user asked to promote and the vercel CLI is authed).
2. Report its last 5 lines, nothing else.
3. Vercel auto-promotes every `master` build (since 2026-10-20), so the push is the release. After the build, check `/sw.js` shows the new `ysc-vN` and `/health` `schema.current` matches. No manual promote step.
Never run the steps (tests, merge, push, promote) by hand; if the script fails, report the failure and stop.
State lives in `DEPLOY.md`.

#!/usr/bin/env bash
# Ship <branch>: gate (spa-syntax, typecheck, SW bump), test, record DEPLOY.md, ff-only master, push, report the Vercel build.
# Usage: bash scripts/ship.sh [--dry-run] [--promote] <branch>   (run from a clean worktree on <branch>)
set -euo pipefail
DRY= PROMOTE= BR=
for a in "$@"; do case $a in --dry-run) DRY=1;; --promote) PROMOTE=1;; *) BR=$a;; esac; done
[ -n "$BR" ] || { echo "usage: ship.sh [--dry-run] [--promote] <branch>"; exit 2; }
run() { if [ -n "$DRY" ]; then echo "dry: $*"; else "$@"; fi; }
cd "$(git rev-parse --show-toplevel)"

git fetch -q origin
SHA=$(git rev-parse "$BR")
[ -n "$DRY" ] || [ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "FAIL: checkout $BR here first"; exit 1; }
[ -n "$DRY" ] || [ -z "$(git status --porcelain)" ] || { echo "FAIL: worktree not clean"; exit 1; }
git merge-base --is-ancestor origin/master "$SHA" || { echo "FAIL: $BR is not a fast-forward of origin/master (rebase first)"; exit 1; }

# Link contract: shared with the 11.1 console.
if git diff --name-only origin/master "$SHA" | grep -qE '^src/(core/link-|services/(link|sync)|api/controllers/(link|sync)\.controller|tests/fixtures/elvanto-link/)'; then
  echo "link contract changed: ship this before the console; console e2e = spike/e2e-ys-link.js in 11.1"
fi

# Gates: cheap and read-only, so they run on --dry-run too. Fail before tests and before DEPLOY.md is touched.
node scripts/check-spa-syntax.js || { echo "FAIL: an inline <script> in public/index.html does not parse"; exit 1; }
npm run -s typecheck || { echo "FAIL: typecheck (npm run typecheck)"; exit 1; }
# SW cache rule (CLAUDE.md "Service worker"): anything under public/ other than sw.js changed => CACHE must be bumped.
if git diff --name-only origin/master "$SHA" -- public/ | grep -qv '^public/sw\.js$'; then
  git diff origin/master "$SHA" -- public/sw.js | grep -q '^+const CACHE = ' \
    || { echo "FAIL: public/ changed but public/sw.js CACHE (ysc-vN) was not bumped"; exit 1; }
fi

LOG=$(mktemp)
if [ -n "$DRY" ]; then echo "dry: npm test > $LOG"
elif npm test >"$LOG" 2>&1; then echo "tests: $(sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -E '^\s*Tests ' | tr -s ' ' | tail -1)"
else echo "FAIL tests (log $LOG):"; { grep -E 'FAIL|AssertionError|Error:' "$LOG" | sort -u | head -15 || tail -5 "$LOG"; }; exit 1; fi

MIG=$(ls supabase/migrations | tail -1 | cut -c1-4)
SW=$(grep -oE "ysc-v[0-9]+" public/sw.js | head -1)
PEND=$(git branch --no-merged "$SHA" --format='%(refname:short)' | tr '\n' ' ')
NOW=$(date '+%Y-%m-%d %H:%M %Z')
# Rewrite the live block (between the markers); the rest of DEPLOY.md is hand-written.
BLOCK="<!-- live -->
- master sha: ${SHA:0:7} ($BR)
- last ship: $NOW
- migration: $MIG
- SW version: $SW
- promote: auto (Vercel promotes every master build); check /health after the build
- pending branches: ${PEND:-none}
<!-- /live -->"
if [ -n "$DRY" ]; then echo "dry: rewrite DEPLOY.md live block (mig $MIG, $SW), commit on $BR"
else
  awk -v b="$BLOCK" '/<!-- live -->/{print b; s=1} /<!-- \/live -->/{s=0; next} !s' DEPLOY.md > DEPLOY.md.tmp && mv DEPLOY.md.tmp DEPLOY.md
  git commit -qm "deploy: ship $BR ${SHA:0:7}" DEPLOY.md
  SHA=$(git rev-parse HEAD)
fi
run git push -q origin "$SHA:refs/heads/master"
run git fetch -q origin master:master 2>/dev/null || true   # ff local master unless it is checked out somewhere

if ! command -v vercel >/dev/null || ! vercel whoami >/dev/null 2>&1; then
  echo "${DRY:+dry: }pushed ${SHA:0:7} to master; vercel CLI unavailable: Vercel auto-promotes; check the build log and /health"; exit 0; fi
[ -n "$DRY" ] && { echo "dry: wait for vercel deployment of $SHA, auto-promoted by Vercel"; exit 0; }
# ponytail: untested here (no CLI on the build box); polls ~3 min for the git deployment to appear.
URL=
# The Vercel project name of this location (a fork links its own project); Brisbane has none checked in, so ys-connection.
PROJ=$(node -e "try{process.stdout.write((p=>p.projectName||p.name||'ys-connection')(require('./.vercel/project.json')))}catch{process.stdout.write('ys-connection')}")
for _ in $(seq 36); do URL=$(vercel ls "$PROJ" -m githubCommitSha="$SHA" 2>/dev/null | grep -m1 https || true); [ -n "$URL" ] && break; sleep 5; done
[ -n "$URL" ] || { echo "pushed ${SHA:0:7}; no Vercel deployment seen yet: check Vercel"; exit 1; }
vercel inspect "$URL" --wait --timeout 10m >/dev/null 2>&1 || { echo "FAIL: Vercel build failed: $URL"; exit 1; }
if [ -n "$PROMOTE" ]; then vercel promote "$URL" --yes >/dev/null && echo "promoted: $URL"
else echo "built (Vercel auto-promotes master): $URL"; fi

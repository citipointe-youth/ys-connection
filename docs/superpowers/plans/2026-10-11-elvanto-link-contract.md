# Elvanto link contract (step 0): implementation plan

> **For agentic workers:** use superpowers:subagent-driven-development (parallel lanes) or superpowers:executing-plans.
> Steps use checkbox (`- [ ]`) syntax. Read the brief (`C:\Users\ThomasPC\src\link-run\brief.md`, binding) and spec §9
> before starting a task.

**Goal:** Ship only the step 0 deliverables of spec §9: shared JSON fixtures, `src/core/link-contract.ts`, one contract
test per repo, and the fixture copy in 11.1. Both later orchestrators then build against these files.

**Spec:** `docs/superpowers/specs/2026-10-11-elvanto-link-contract.md` (commit `f2aa69d`). Review context:
`C:\Users\ThomasPC\src\link-run\spec-review.md` (its fixes are already in the spec).

**Tech:** YS: TypeScript (CommonJS, strict, `noUncheckedIndexedAccess`), Zod 3, vitest. 11.1: plain Node CommonJS, no test
framework (`spike/verify-*.js` + a `check()` helper). **No new dependencies in either repo.**

## Repos, branches, lanes

| Lane | Repo (path) | Branch | Touches only |
|---|---|---|---|
| **A** | YS Connection `C:\Users\ThomasPC\src\ys-connection` | `feature/elvanto-link-contract` | `src/tests/fixtures/elvanto-link/*.json`, `src/core/link-contract.ts`, `src/tests/link-contract.test.ts` |
| **B** | 11.1 worktree `C:\Users\ThomasPC\src\wt-11.1-link` | `feature/ys-link-contract` | `spike/fixtures/ys-link/*.json`, `spike/verify-ys-link-contract.js` (+ an uncommitted `node_modules` junction) |

The lanes never touch the same files. Dependencies:

```
A1 (fixtures) ──► A2 ──► A3 ──┐
   └────────────► B1 ──► B2 ──┴──► F1 (controller: final verification)
```

- **B1 needs A1's commit** (it copies A1's fixtures). B1 and B2 run in parallel with A2 and A3.
- **Fixtures are frozen after A1.** If A2 or A3 must change a fixture, that task regenerates the manifest, commits, and
  tells the controller. The controller then re-runs B1 step 4 to step 7 and B2 step 3 before F1.

## Guardrails (every task, both lanes)

- **No `git push`.** Commit to the lane's feature branch only. Stage explicit paths. Never `git add -A` or `git add .`.
- **Nothing in `supabase/migrations/`.** The draft SQL stays in `docs/superpowers/specs/`. `LATEST_MIGRATION` stays `'0015'`.
- **No prod and no Supabase MCP writes.** No `apply_migration` or `execute_sql`. No Vercel changes.
- **No live Elvanto reads or writes.** Use the fixtures and stubs only. No script in this plan opens a browser or a socket.
- **Never touch the main 11.1 checkout** (`...\OneDrive\Desktop\AIProjects\Project 11.1 - Elvanto Sync Console`). The
  only exception is the read-only junction target. **Never delete through the junction.** To remove it, run
  `cmd /c rmdir node_modules` (this removes the link only). Never use `rm -rf node_modules`.
- **Never commit `node_modules`.**
- **Public repo hygiene** (both repos): fake names, fake UUIDs (`…-4000-8000-…`), no tenant URL, no real email, no local
  user paths in committed code or fixtures.
- Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  ```

## Verification commands

- **YS** (from `C:\Users\ThomasPC\src\ys-connection`): `npx tsc --noEmit && npx vitest run`. Expected: tsc prints
  nothing, and vitest ends with `Test Files  N passed (N)` with no failures. The SPA is not touched, so
  `node scripts/check-spa-syntax.js` is not needed. If a task touches `public/`, stop: it is out of scope.
- **11.1** (from `C:\Users\ThomasPC\src\wt-11.1-link`): there is no `npm test`. The suite is a rule (11.1 `CLAUDE.md`
  "The suite is a rule, never a list"): run every `spike/verify-*.js` except `verify-smtp.js` and
  `verify-credentials.js`, plus every `spike/drive-*.js`. Run `verify-server.js` alone and last. Each script prints
  `PASS`/`FAIL` lines and exits non-zero on failure. The full loop is in F1. Per task, run the targeted scripts named in
  that task.

## Draft SQL check (done while writing this plan, no task)

I read `docs/superpowers/specs/2026-10-11-elvanto-link-0016.draft.sql` against spec §2 and found **no defect**. The
column sets and checks for type and status match §2.1 to §2.3. The open-row partial unique index is
(`pending`, `claimed`, `unclear`). There is no FK. All 7 tables have `enable row level security`. **No task edits the
draft.** A2's rule test pins its RLS lines.

## Fixture ids (used by A1, B2)

| Name | UUID | Meaning |
|---|---|---|
| CONSOLE | `8f5a1c2e-0000-4000-8000-000000000001` | consoleId |
| O1…O9, O10 | `0a000000-0000-4000-8000-00000000000N`, N = `1`…`9`, `a` | outbox ids (O1 checkIn, O2 checkOut, O3 submitReport, O4 editReport, O5 completeStep, O6 firstTimerCheckIn) |
| SV | `5e000000-0000-4000-8000-000000000001` | service |
| ST | `57000000-0000-4000-8000-000000000001` | service time, Fri 2026-10-16 6:30 pm Brisbane |
| YP / KYT | `40000000-0000-4000-8000-000000000001` / `…002` | rooms "Youth Program" / "Kids/Youth Team" |
| P1 | `9e000000-0000-4000-8000-000000000001` | Alex Sample, student, male, grade 9 |
| P2 | `9e000000-0000-4000-8000-000000000002` | Sam Example, leader, female |
| P3 | `9e000000-0000-4000-8000-000000000003` | Jamie Test, student, female, grade 9 (already checked in) |
| P4 | `9e000000-0000-4000-8000-000000000004` | Casey Other, kind other |
| FT | `9e000000-0000-4000-8000-000000000005` | Riley Newperson, the approved first-timer (only in results) |
| G1 / G2 | `6a000000-0000-4000-8000-000000000001` / `…002` | Grade 9 Girls / Grade 9 Boys lifegroup |
| R1 / R2 / R3 | `7e000000-0000-4000-8000-00000000000N` | G1's last report / G2's last report / the new report from O3 |
| FLOW / STEP | `f1000000-0000-4000-8000-000000000001` / `f5000000-0000-4000-8000-000000000001` | flow, step |
| ROW1 / ROW2 | `f7000000-0000-4000-8000-000000000001` / `…002` | flow rows |

---

## Lane A: YS Connection

### Task A1: Fixtures + manifest

**Files:** create `src/tests/fixtures/elvanto-link/` with the 11 files below.
**Depends on:** nothing.
**Guardrails:** no push; nothing in `supabase/migrations/`; no prod or Supabase MCP writes; no live Elvanto; never the
main 11.1 checkout; never commit node_modules; explicit paths only.

- [ ] **Step 1: Install and baseline.** `cd /c/Users/ThomasPC/src/ys-connection && git status --short && npm ci && npx tsc --noEmit && npx vitest run`
  Expected: a clean tree (the plan file is committed), and tsc and vitest both green. Write down the passing test-file count.
- [ ] **Step 2: Write the 10 data fixtures exactly as below** (2-space indent, LF, trailing newline).

`claim-request.json` (`max` is 6, so the one-row-per-type response below is a valid answer to it):
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "consoleLabel": "laptop",
  "consoleVersion": "11.1@185d8d6",
  "inWindow": true,
  "pollSeconds": 60,
  "capabilities": {
    "checkIn": "shadow",
    "checkOut": "off",
    "submitReport": "shadow",
    "editReport": "shadow",
    "completeStep": "shadow",
    "firstTimerCheckIn": "shadow"
  },
  "max": 6,
  "leaseSeconds": 180
}
```

`claim-response.json`:
```json
{
  "contractVersion": 1,
  "serverTime": "2026-10-16T08:31:02.120Z",
  "rows": [
    {
      "id": "0a000000-0000-4000-8000-000000000001", "type": "checkIn", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:55.000Z", "serviceDate": "2026-10-16",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": { "serviceTimeId": "57000000-0000-4000-8000-000000000001", "serviceId": "5e000000-0000-4000-8000-000000000001", "personId": "9e000000-0000-4000-8000-000000000001" },
      "note": null
    },
    {
      "id": "0a000000-0000-4000-8000-000000000002", "type": "checkOut", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:56.000Z", "serviceDate": "2026-10-16",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": { "serviceTimeId": "57000000-0000-4000-8000-000000000001", "personId": "9e000000-0000-4000-8000-000000000003" },
      "note": null
    },
    {
      "id": "0a000000-0000-4000-8000-000000000003", "type": "submitReport", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:57.000Z", "serviceDate": "2026-10-13",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": { "groupId": "6a000000-0000-4000-8000-000000000002", "date": "2026-10-13", "didNotMeet": false, "attendees": ["9e000000-0000-4000-8000-000000000001"], "guests": 2, "notesPrivate": false },
      "note": "Good night, talked about the parable of the sower."
    },
    {
      "id": "0a000000-0000-4000-8000-000000000004", "type": "editReport", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:58.000Z", "serviceDate": "2026-10-12",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": {
        "groupId": "6a000000-0000-4000-8000-000000000001", "reportId": "7e000000-0000-4000-8000-000000000001",
        "date": "2026-10-12", "didNotMeet": false, "attendees": ["9e000000-0000-4000-8000-000000000003"], "guests": 1, "notesPrivate": false,
        "base": { "date": "2026-10-12", "didNotMeet": false, "attendees": ["9e000000-0000-4000-8000-000000000003"], "guests": 0 }
      },
      "note": "Forgot a guest."
    },
    {
      "id": "0a000000-0000-4000-8000-000000000005", "type": "completeStep", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:30:59.000Z", "serviceDate": "2026-10-16",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": { "rowId": "f7000000-0000-4000-8000-000000000001", "flowId": "f1000000-0000-4000-8000-000000000001", "stepId": "f5000000-0000-4000-8000-000000000001", "personId": "9e000000-0000-4000-8000-000000000001", "notePrivate": true },
      "note": "Called, left a message."
    },
    {
      "id": "0a000000-0000-4000-8000-000000000006", "type": "firstTimerCheckIn", "attempts": 1, "reclaimed": false,
      "createdAt": "2026-10-16T08:31:00.000Z", "serviceDate": "2026-10-16",
      "by": { "login": "grade9g", "leaderName": "Test Leader" },
      "payload": { "serviceTimeId": "57000000-0000-4000-8000-000000000001", "serviceId": "5e000000-0000-4000-8000-000000000001", "firstName": "Riley", "lastName": "Newperson", "grade": 8, "gender": "female" },
      "note": null
    }
  ]
}
```

`result-request.json` (one result for each outcome; `sent` appears 3 times, as in spec §3.3):
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "results": [
    { "id": "0a000000-0000-4000-8000-000000000001", "outcome": "sent", "sentLogKey": "checkIn:service:57000000-0000-4000-8000-000000000001:9e000000-0000-4000-8000-000000000001" },
    { "id": "0a000000-0000-4000-8000-000000000003", "outcome": "sent", "sentLogKey": "submitReport:lifegroup:6a000000-0000-4000-8000-000000000002:20261013", "reportId": "7e000000-0000-4000-8000-000000000003" },
    { "id": "0a000000-0000-4000-8000-000000000006", "outcome": "sent", "sentLogKey": "checkIn:service:57000000-0000-4000-8000-000000000001:9e000000-0000-4000-8000-000000000005", "personId": "9e000000-0000-4000-8000-000000000005" },
    { "id": "0a000000-0000-4000-8000-000000000007", "outcome": "already" },
    { "id": "0a000000-0000-4000-8000-000000000004", "outcome": "refused", "reason": "report-changed", "detail": "This report changed in Elvanto." },
    { "id": "0a000000-0000-4000-8000-000000000008", "outcome": "unclear", "sentLogKey": "checkIn:service:57000000-0000-4000-8000-000000000001:9e000000-0000-4000-8000-000000000003", "detail": "Elvanto may not have saved this." },
    { "id": "0a000000-0000-4000-8000-000000000009", "outcome": "retry", "retrySeconds": 300, "reason": "awaiting-approval" },
    { "id": "0a000000-0000-4000-8000-000000000005", "outcome": "shadowed", "sentLogKey": "complete:ys:f7000000-0000-4000-8000-000000000001" },
    { "id": "0a000000-0000-4000-8000-00000000000a", "outcome": "resolved", "landed": true }
  ]
}
```

`result-response.json`:
```json
{
  "applied": [
    "0a000000-0000-4000-8000-000000000001", "0a000000-0000-4000-8000-000000000003", "0a000000-0000-4000-8000-000000000006",
    "0a000000-0000-4000-8000-000000000007", "0a000000-0000-4000-8000-000000000004", "0a000000-0000-4000-8000-000000000008",
    "0a000000-0000-4000-8000-000000000009", "0a000000-0000-4000-8000-000000000005"
  ],
  "ignored": [{ "id": "0a000000-0000-4000-8000-00000000000a", "why": "already-final" }]
}
```

`push-roster.json`:
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "takenAt": "2026-10-16T08:30:00.000Z",
  "rows": [
    { "personId": "9e000000-0000-4000-8000-000000000001", "firstName": "Alex", "lastName": "Sample", "gender": "male", "grade": 9, "kind": "student" },
    { "personId": "9e000000-0000-4000-8000-000000000002", "firstName": "Sam", "lastName": "Example", "gender": "female", "grade": null, "kind": "leader" },
    { "personId": "9e000000-0000-4000-8000-000000000003", "firstName": "Jamie", "lastName": "Test", "gender": "female", "grade": 9, "kind": "student" },
    { "personId": "9e000000-0000-4000-8000-000000000004", "firstName": "Casey", "lastName": "Other", "gender": null, "grade": null, "kind": "other" }
  ]
}
```

`push-services.json`:
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "takenAt": "2026-10-16T08:30:00.000Z",
  "rows": [
    {
      "serviceTimeId": "57000000-0000-4000-8000-000000000001",
      "serviceId": "5e000000-0000-4000-8000-000000000001",
      "name": "Friday Night Youth",
      "startsAt": "2026-10-16T08:30:00.000Z",
      "ymd": "2026-10-16",
      "rooms": [
        { "id": "40000000-0000-4000-8000-000000000001", "name": "Youth Program" },
        { "id": "40000000-0000-4000-8000-000000000002", "name": "Kids/Youth Team" }
      ],
      "checkedIn": [{ "personId": "9e000000-0000-4000-8000-000000000003", "roomId": "40000000-0000-4000-8000-000000000001" }]
    }
  ]
}
```

`push-groups.json`:
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "takenAt": "2026-10-16T08:30:00.000Z",
  "rows": [
    {
      "groupId": "6a000000-0000-4000-8000-000000000001",
      "name": "Grade 9 Girls Lifegroup",
      "meets": "Mon 7:00 PM",
      "members": [
        { "personId": "9e000000-0000-4000-8000-000000000003", "name": "Jamie Test", "leader": false },
        { "personId": "9e000000-0000-4000-8000-000000000002", "name": "Sam Example", "leader": true }
      ],
      "thisWeek": "reported",
      "lastReport": {
        "reportId": "7e000000-0000-4000-8000-000000000001", "date": "2026-10-12", "time": "7:00 PM", "didNotMeet": false,
        "attendees": ["9e000000-0000-4000-8000-000000000003"], "guests": 0, "serviceTimeId": null, "editable": true, "blocked": null
      }
    },
    {
      "groupId": "6a000000-0000-4000-8000-000000000002",
      "name": "Grade 9 Boys Lifegroup",
      "meets": "Tue 6:30 PM",
      "members": [
        { "personId": "9e000000-0000-4000-8000-000000000001", "name": "Alex Sample", "leader": false },
        { "personId": "9e000000-0000-4000-8000-000000000004", "name": "Casey Other", "leader": true }
      ],
      "thisWeek": "none",
      "lastReport": {
        "reportId": "7e000000-0000-4000-8000-000000000002", "date": "2026-10-06", "time": "6:30 PM", "didNotMeet": false,
        "attendees": ["9e000000-0000-4000-8000-000000000001"], "guests": 0, "serviceTimeId": null, "editable": false, "blocked": "unkept-notes"
      }
    }
  ]
}
```

`push-flows.json`:
```json
{
  "contractVersion": 1,
  "consoleId": "8f5a1c2e-0000-4000-8000-000000000001",
  "takenAt": "2026-10-16T08:30:00.000Z",
  "rows": [
    {
      "rowId": "f7000000-0000-4000-8000-000000000001", "flowId": "f1000000-0000-4000-8000-000000000001", "flowName": "New Youth Follow Up",
      "stepId": "f5000000-0000-4000-8000-000000000001", "stepName": "Call within a week", "stepOrder": 1,
      "personId": "9e000000-0000-4000-8000-000000000001", "name": "Alex Sample", "due": "2026-10-20", "assignedTo": "Sam Example"
    },
    {
      "rowId": "f7000000-0000-4000-8000-000000000002", "flowId": "f1000000-0000-4000-8000-000000000001", "flowName": "New Youth Follow Up",
      "stepId": "f5000000-0000-4000-8000-000000000001", "stepName": "Call within a week", "stepOrder": 1,
      "personId": null, "name": "Morgan Unlinked", "due": null, "assignedTo": ""
    }
  ]
}
```

`push-response.json` (an array: a roster reply, another kind's reply, a stale push):
```json
[
  { "applied": true, "rows": 4, "matched": { "auto": 2, "ambiguous": 0 } },
  { "applied": true, "rows": 1 },
  { "applied": false }
]
```

`errors.json` (one body per spec §3.1 code; `SERVICE_UNAVAILABLE` and `REQUEST_TIMEOUT` are the existing transient
503 codes in `src/api/middleware/error.middleware.ts`):
```json
[
  { "status": 401, "body": { "code": "UNAUTHORIZED", "message": "Missing or invalid sync token." } },
  { "status": 503, "body": { "code": "LINK_OFF", "message": "The YS link is off." } },
  { "status": 409, "body": { "code": "LINK_CONTRACT_MISMATCH", "message": "Contract version mismatch.", "expected": 1 } },
  { "status": 400, "body": { "code": "VALIDATION_ERROR", "message": "Validation failed", "details": [] } },
  { "status": 503, "body": { "code": "SERVICE_UNAVAILABLE", "message": "The service is temporarily unavailable. Please try again." } },
  { "status": 503, "body": { "code": "REQUEST_TIMEOUT", "message": "This is taking longer than expected. Please try again." } }
]
```

- [ ] **Step 3: Generate `manifest.json`** (from the repo root, Git Bash). This command is also the regeneration
  command for every later contract change:
  ```bash
  node -e 'const fs=require("fs"),c=require("crypto"),d="src/tests/fixtures/elvanto-link/";const files={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="manifest.json").sort())files[f]=c.createHash("sha256").update(JSON.stringify(JSON.parse(fs.readFileSync(d+f,"utf8")))).digest("hex");fs.writeFileSync(d+"manifest.json",JSON.stringify({contractVersion:1,files},null,2)+"\n");console.log(Object.keys(files).length+" fixtures hashed")'
  ```
  Expected: `10 fixtures hashed`. `manifest.json` lists the 10 file names with 64-character hex hashes.
- [ ] **Step 4: Hygiene scan.** `git grep -nIiE "citipointe|ys-connection\.vercel|elvanto\.com\.au|987tom1@|thomas@|ThomasPC" -- src/tests/fixtures/elvanto-link` (run after `git add` in step 5, or use `grep -rniE` with the same pattern now). Expected: no output.
- [ ] **Step 5: Commit.**
  ```bash
  git add src/tests/fixtures/elvanto-link/*.json
  git commit -F - <<'EOF'
  test(link): Elvanto link contract fixtures + manifest (step 0)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  EOF
  ```
  Report the commit SHA to the controller. **This unblocks B1.**

### Task A2: Contract constants + manifest test + draft-SQL RLS rule test

**Files:** create `src/core/link-contract.ts` and `src/tests/link-contract.test.ts`.
**Depends on:** A1.
**Guardrails:** no push; nothing in `supabase/migrations/`; no prod or Supabase MCP writes; no live Elvanto; never the
main 11.1 checkout; never commit node_modules; explicit paths only.

- [ ] **Step 1: Write the failing test** `src/tests/link-contract.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as C from '../core/link-contract';

// Step 0 contract test (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md, section 9).
// The fixtures are the source of truth; Project 11.1 keeps a byte copy in spike/fixtures/ys-link/.
// After any fixture change: bump LINK_CONTRACT_VERSION if the shape changed, regenerate the manifest from the repo root
//   node -e 'const fs=require("fs"),c=require("crypto"),d="src/tests/fixtures/elvanto-link/";const files={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="manifest.json").sort())files[f]=c.createHash("sha256").update(JSON.stringify(JSON.parse(fs.readFileSync(d+f,"utf8")))).digest("hex");fs.writeFileSync(d+"manifest.json",JSON.stringify({contractVersion:1,files},null,2)+"\n")'
// and copy all 11 files into 11.1 in the same session (spec section 9 has the cp command).
const ROOT = join(__dirname, '..', '..');
const DIR = join(__dirname, 'fixtures', 'elvanto-link');
const load = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const hash = (f: string) => createHash('sha256').update(JSON.stringify(load(f))).digest('hex');

describe('link contract: manifest', () => {
  const manifest = load('manifest.json');
  it('carries the contract version', () => expect(manifest.contractVersion).toBe(C.LINK_CONTRACT_VERSION));
  it('lists every fixture with its normalised sha256', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
    expect(Object.keys(manifest.files).sort()).toEqual(files);
    for (const f of files) expect(manifest.files[f], f).toBe(hash(f));
  });
});

describe('link contract: draft SQL', () => {
  // The YS stream moves this file into supabase/migrations/ and updates this path in the same commit.
  const sql = readFileSync(join(ROOT, 'docs', 'superpowers', 'specs', '2026-10-11-elvanto-link-0016.draft.sql'), 'utf8');
  it('enables RLS on every table it creates (by rule)', () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]!);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(sql, t).toMatch(new RegExp(`alter table\\s+${t}\\s+enable row level security`, 'i'));
  });
});
```
- [ ] **Step 2: Run it. It fails.** `npx vitest run src/tests/link-contract.test.ts`
  Expected: FAIL. The module `../core/link-contract` cannot be resolved.
- [ ] **Step 3: Create `src/core/link-contract.ts` (constants only for now):**
```ts
import { z } from 'zod';

// Step 0 of the YS Connection <-> Elvanto Sync Console link (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md).
// Shapes only: no routes, no services. Fixtures: src/tests/fixtures/elvanto-link/ (11.1 keeps a byte copy).
// A shape change bumps LINK_CONTRACT_VERSION, the fixtures and the manifest, and is copied to 11.1 in the same session.
export const LINK_CONTRACT_VERSION = 1;

export const ACTION_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn'] as const;
export const STATUSES = ['pending', 'claimed', 'sent', 'refused', 'unclear', 'shadowed', 'cancelled'] as const;
export const OUTCOMES = ['sent', 'already', 'refused', 'unclear', 'retry', 'shadowed', 'resolved'] as const;
export const CAPABILITIES = ['live', 'shadow', 'off'] as const;
export const PUSH_KINDS = ['roster', 'services', 'groups', 'flows'] as const;
export const RETRY_REASONS = ['console-busy', 'awaiting-approval', 'console-cannot-read'] as const;
// Spec 5.4: every stable code, incl. the non-refusals (already, console-busy, awaiting-approval) the app shows as status.
export const REASONS = ['locked', 'no-room', 'person-unknown', 'report-exists', 'report-not-found', 'report-changed',
  'member-left', 'not-in-group', 'multi-service', 'unkept-notes', 'service-not-offered', 'pick-service', 'note-too-long',
  'did-not-meet-conflict', 'step-moved', 'assignee-needed', 'ambiguous-first-timer', 'too-old', 'not-landed',
  'console-cannot-read', 'unknown', 'lease-lost', 'note-unreadable', 'already', 'console-busy', 'awaiting-approval'] as const;
// Spec 3.1 (+ the two existing transient 503 codes from error.middleware.ts).
export const SYNC_ERROR_CODES = ['UNAUTHORIZED', 'LINK_OFF', 'LINK_CONTRACT_MISMATCH', 'VALIDATION_ERROR',
  'SERVICE_UNAVAILABLE', 'REQUEST_TIMEOUT'] as const;
```
  (The `z` import is used in A3. If the linter or tsc complains about an unused import, leave it out until A3.)
- [ ] **Step 4: Run it. It passes.** `npx vitest run src/tests/link-contract.test.ts`. Expected: 3 tests pass.
- [ ] **Step 5: Prove the hash check catches a change.** Change `"assignedTo": ""` to `"assignedTo": "x"` in
  `push-flows.json`. Run it. Expected: FAIL on `push-flows.json`. Restore the file with
  `git checkout -- src/tests/fixtures/elvanto-link/push-flows.json`, then run it again. Expected: pass.
- [ ] **Step 6: Full verification.** `npx tsc --noEmit && npx vitest run`. Expected: green, and the test-file count is
  A1's baseline + 1.
- [ ] **Step 7: Commit.**
  ```bash
  git add src/core/link-contract.ts src/tests/link-contract.test.ts
  git commit -F - <<'EOF'
  feat(link): link-contract constants; manifest + draft-SQL RLS rule test (step 0)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  EOF
  ```

### Task A3: Zod schemas for every `/sync` body and payload + fixture tests

**Files:** modify `src/core/link-contract.ts` and `src/tests/link-contract.test.ts`.
**Depends on:** A2.
**Guardrails:** no push; nothing in `supabase/migrations/`; no prod or Supabase MCP writes; no live Elvanto; never the
main 11.1 checkout; never commit node_modules; explicit paths only.

- [ ] **Step 1: Append the failing tests** to `src/tests/link-contract.test.ts`. Add `import { z } from 'zod';` to the
  imports.
```ts
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const rejects = (schema: z.ZodTypeAny, v: unknown) => expect(schema.safeParse(v).success).toBe(false);

const FIXTURES: Record<string, z.ZodTypeAny> = {
  'claim-request.json': C.ClaimRequest,
  'claim-response.json': C.ClaimResponse,
  'result-request.json': C.ResultRequest,
  'result-response.json': C.ResultResponse,
  'push-roster.json': C.PUSH_SCHEMAS.roster,
  'push-services.json': C.PUSH_SCHEMAS.services,
  'push-groups.json': C.PUSH_SCHEMAS.groups,
  'push-flows.json': C.PUSH_SCHEMAS.flows,
  'push-response.json': z.array(C.PushResponse).min(1),
  'errors.json': z.array(z.object({ status: z.number().int(), body: C.ErrorBody })).min(1),
};

describe('link contract: every fixture parses with its schema', () => {
  it('covers every fixture file', () => expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(load('manifest.json').files).sort()));
  for (const [f, schema] of Object.entries(FIXTURES)) it(f, () => { schema.parse(load(f)); });

  it('claim-response has one row per action type; each payload parses with its type schema', () => {
    const rows = C.ClaimResponse.parse(load('claim-response.json')).rows;
    expect(rows.map((r) => r.type).sort()).toEqual([...C.ACTION_TYPES].sort());
    for (const r of rows) (C.PAYLOAD_SCHEMAS[r.type] as z.ZodTypeAny).parse(r.payload);
  });
  it('result-request has every outcome', () => {
    const outcomes = new Set(C.ResultRequest.parse(load('result-request.json')).results.map((r) => r.outcome));
    expect([...outcomes].sort()).toEqual([...C.OUTCOMES].sort());
  });
  it('errors.json is the section 3.1 set', () => {
    const errs = load('errors.json') as { status: number; body: { code: string } }[];
    expect(errs.map((e) => `${e.status} ${e.body.code}`).sort()).toEqual(['400 VALIDATION_ERROR', '401 UNAUTHORIZED',
      '409 LINK_CONTRACT_MISMATCH', '503 LINK_OFF', '503 REQUEST_TIMEOUT', '503 SERVICE_UNAVAILABLE']);
    expect([...new Set(errs.map((e) => e.body.code))].sort()).toEqual([...C.SYNC_ERROR_CODES].sort());
  });
});

describe('link contract: bad requests are rejected', () => {
  const REQUESTS: [string, z.ZodTypeAny][] = [
    ['claim-request.json', C.ClaimRequest], ['result-request.json', C.ResultRequest],
    ['push-roster.json', C.PUSH_SCHEMAS.roster], ['push-services.json', C.PUSH_SCHEMAS.services],
    ['push-groups.json', C.PUSH_SCHEMAS.groups], ['push-flows.json', C.PUSH_SCHEMAS.flows],
  ];
  for (const [f, schema] of REQUESTS) {
    it(`${f}: missing or other contractVersion, non-uuid or upper-case consoleId`, () => {
      const missing = clone(load(f)); delete missing.contractVersion; rejects(schema, missing);
      rejects(schema, { ...load(f), contractVersion: 2 });
      rejects(schema, { ...load(f), consoleId: 'not-a-uuid' });
      rejects(schema, { ...load(f), consoleId: load(f).consoleId.toUpperCase() });
    });
  }
  it('unknown types, outcomes, capabilities and kinds are rejected', () => {
    const claim = clone(load('claim-request.json')); claim.capabilities.bogus = 'live'; rejects(C.ClaimRequest, claim);
    const result = clone(load('result-request.json')); result.results[0].outcome = 'bogus'; rejects(C.ResultRequest, result);
    const rows = clone(load('claim-response.json')); rows.rows[0].type = 'bogus'; rejects(C.ClaimResponse, rows);
    const roster = clone(load('push-roster.json')); roster.rows[0].kind = 'bogus'; rejects(C.PUSH_SCHEMAS.roster, roster);
  });
  it('a push over 5,000 rows is rejected', () => {
    const roster = load('push-roster.json');
    rejects(C.PUSH_SCHEMAS.roster, { ...roster, rows: Array(5001).fill(roster.rows[0]) });
  });
  it('a payload with an extra field, or did-not-meet with attendees, is rejected', () => {
    const p = load('claim-response.json').rows.find((r: any) => r.type === 'submitReport').payload;
    rejects(C.PAYLOAD_SCHEMAS.submitReport, { ...p, phone: '0400 000 000' });
    rejects(C.PAYLOAD_SCHEMAS.submitReport, { ...p, didNotMeet: true });
  });
});
```
- [ ] **Step 2: Run it. It fails.** `npx vitest run src/tests/link-contract.test.ts`
  Expected: FAIL. `C.ClaimRequest` and the other schemas are undefined (`Cannot read properties of undefined`).
- [ ] **Step 3: Append the schemas** to `src/core/link-contract.ts`:
```ts
const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'lower-case uuid');
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso = z.string().datetime();
const Name = z.string().trim().min(1).max(60);
const Text = (max: number) => z.string().max(max);
const Grade = z.number().int().min(7).max(12).nullable();
const Gender = z.enum(['male', 'female']);
// A literal: the /sync handler checks the version BEFORE parsing, so a mismatch is 409 LINK_CONTRACT_MISMATCH, not 400.
const Version = z.literal(LINK_CONTRACT_VERSION);

// ---- Payloads (spec 5.1). Strict: an outbox payload holds ids and small values only.
const reportFields = { groupId: Uuid, date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
  guests: z.number().int().min(0).max(99), notesPrivate: z.boolean() };
const noAttendeesIfDidNotMeet = (p: { didNotMeet: boolean; attendees: string[] }) => !p.didNotMeet || p.attendees.length === 0;
export const PAYLOAD_SCHEMAS = {
  checkIn: z.object({ serviceTimeId: Uuid, serviceId: Uuid, personId: Uuid }).strict(),
  checkOut: z.object({ serviceTimeId: Uuid, personId: Uuid }).strict(),
  submitReport: z.object(reportFields).strict().refine(noAttendeesIfDidNotMeet, 'didNotMeet means no attendees'),
  editReport: z.object({ ...reportFields, reportId: Uuid,
    base: z.object({ date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300), guests: z.number().int().min(0).max(999) }).strict(),
  }).strict().refine(noAttendeesIfDidNotMeet, 'didNotMeet means no attendees'),
  completeStep: z.object({ rowId: Uuid, flowId: Uuid, stepId: Uuid, personId: Uuid.nullable(), notePrivate: z.boolean() }).strict(),
  firstTimerCheckIn: z.object({ serviceTimeId: Uuid, serviceId: Uuid, firstName: Name, lastName: Name, grade: Grade, gender: Gender }).strict(),
} satisfies Record<(typeof ACTION_TYPES)[number], z.ZodTypeAny>;

// ---- POST /sync/claim (spec 3.2)
const Cap = z.enum(CAPABILITIES);
export const ClaimRequest = z.object({
  contractVersion: Version, consoleId: Uuid, consoleLabel: Text(60), consoleVersion: Text(60),
  inWindow: z.boolean(), pollSeconds: z.number().int().min(10).max(3600),
  capabilities: z.object({ checkIn: Cap, checkOut: Cap, submitReport: Cap, editReport: Cap, completeStep: Cap, firstTimerCheckIn: Cap }).strict(),
  max: z.number().int().min(0).max(20).default(3),
  leaseSeconds: z.number().int().min(30).max(600).default(180),
});
export const ClaimRow = z.object({
  id: Uuid, type: z.enum(ACTION_TYPES), attempts: z.number().int().min(1), reclaimed: z.boolean(),
  createdAt: Iso, serviceDate: Ymd, by: z.object({ login: z.string(), leaderName: z.string() }),
  payload: z.record(z.unknown()), // parse with PAYLOAD_SCHEMAS[type]
  note: z.string().max(1900).nullable(), // decrypted for the leased row only
});
export const ClaimResponse = z.object({ contractVersion: Version, serverTime: Iso, rows: z.array(ClaimRow).max(20) });

// ---- POST /sync/result (spec 3.3)
const Key = z.string().min(1).max(200);
const Detail = z.string().max(300).optional(); // the console's PII-free sentence
export const ResultItem = z.discriminatedUnion('outcome', [
  z.object({ id: Uuid, outcome: z.literal('sent'), sentLogKey: Key, reportId: Uuid.optional(), personId: Uuid.optional() }),
  z.object({ id: Uuid, outcome: z.literal('already') }),
  z.object({ id: Uuid, outcome: z.literal('refused'), reason: z.enum(REASONS), detail: Detail }),
  z.object({ id: Uuid, outcome: z.literal('unclear'), sentLogKey: Key, detail: Detail }),
  z.object({ id: Uuid, outcome: z.literal('retry'), retrySeconds: z.number().int().min(60).max(3600), reason: z.enum(RETRY_REASONS) }),
  z.object({ id: Uuid, outcome: z.literal('shadowed'), sentLogKey: Key }),
  z.object({ id: Uuid, outcome: z.literal('resolved'), landed: z.boolean() }),
]);
export const ResultRequest = z.object({ contractVersion: Version, consoleId: Uuid, results: z.array(ResultItem).min(1).max(20) });
export const ResultResponse = z.object({
  applied: z.array(Uuid),
  ignored: z.array(z.object({ id: Uuid, why: z.enum(['unknown-id', 'not-leased', 'already-final', 'bad-transition']) })),
});

// ---- POST /sync/push/:kind (spec 3.4). One bad row rejects the whole push.
const RosterRow = z.object({ personId: Uuid, firstName: Name, lastName: Text(60), gender: Gender.nullable(), grade: Grade,
  kind: z.enum(['student', 'leader', 'other']) });
const ServiceRow = z.object({ serviceTimeId: Uuid, serviceId: Uuid, name: Text(120), startsAt: Iso, ymd: Ymd,
  rooms: z.array(z.object({ id: Uuid, name: Text(120) })), checkedIn: z.array(z.object({ personId: Uuid, roomId: Uuid })) });
const GroupRow = z.object({ groupId: Uuid, name: Text(120), meets: Text(40),
  members: z.array(z.object({ personId: Uuid, name: Text(120), leader: z.boolean() })).max(300),
  thisWeek: z.enum(['reported', 'did-not-meet', 'none', 'later', 'unreadable']),
  lastReport: z.object({ reportId: Uuid, date: Ymd, time: Text(10), didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
    guests: z.number().int().min(0).max(999), serviceTimeId: Uuid.nullable(), editable: z.boolean(),
    blocked: z.enum(['multi-service', 'unkept-notes', 'member-left']).nullable() }).nullable() });
const FlowRow = z.object({ rowId: Uuid, flowId: Uuid, flowName: Text(120), stepId: Uuid, stepName: Text(120),
  stepOrder: z.number().int().min(0), personId: Uuid.nullable(), name: Text(120), due: Ymd.nullable(), assignedTo: Text(120) });
const push = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, rows: z.array(row).max(5000) });
export const PUSH_SCHEMAS = { roster: push(RosterRow), services: push(ServiceRow), groups: push(GroupRow), flows: push(FlowRow) }
  satisfies Record<(typeof PUSH_KINDS)[number], z.ZodTypeAny>;
export const PushResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0).optional(),
  matched: z.object({ auto: z.number().int().min(0), ambiguous: z.number().int().min(0) }).optional() });

// ---- Error bodies (spec 3.1); extra fields (expected, details) pass through.
export const ErrorBody = z.object({ code: z.enum(SYNC_ERROR_CODES), message: z.string() }).passthrough();
```
- [ ] **Step 4: Run it. It passes.** `npx vitest run src/tests/link-contract.test.ts`. Expected: every test passes.
  If a fixture fails to parse, **fix the schema to match spec §3 or §5.1, not the fixture**, unless the fixture
  contradicts the spec. If you edit a fixture, follow the "fixtures are frozen" rule above.
- [ ] **Step 5: Full verification.** `npx tsc --noEmit && npx vitest run`. Expected: green. (`satisfies` needs TS ≥ 4.9;
  the repo has 5.6.)
- [ ] **Step 6: Commit.**
  ```bash
  git add src/core/link-contract.ts src/tests/link-contract.test.ts
  git commit -F - <<'EOF'
  feat(link): Zod schemas for every /sync body and action payload + fixture tests (step 0)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  EOF
  ```

---

## Lane B: Elvanto Sync Console 11.1 (worktree)

### Task B1: Junction + copy the fixtures

**Files:** create `spike/fixtures/ys-link/*.json` (11 files, a byte copy of YS). Create an **uncommitted**
`node_modules` junction.
**Depends on:** A1's commit.
**Guardrails:** no push; no prod or Supabase MCP writes; no live Elvanto; **never touch the main 11.1 checkout** (the
junction target is read only; never delete through it); never commit node_modules; explicit paths only; never edit
these fixtures in 11.1.

- [ ] **Step 1: Check the worktree.** `cd /c/Users/ThomasPC/src/wt-11.1-link && git branch --show-current && git status --short`
  Expected: `feature/ys-link-contract` and a clean tree.
- [ ] **Step 2: Create the junction** (PowerShell, in the worktree):
  `cmd /c mklink /J node_modules "C:\Users\ThomasPC\OneDrive\Desktop\AIProjects\Project 11.1 - Elvanto Sync Console\node_modules"`
  Expected: `Junction created for node_modules <<===>> …`. Then run `git status --short`. Expected: no `node_modules` line
  (`.gitignore` has `node_modules/`). If it shows, do not stage it: explicit paths keep it out.
- [ ] **Step 3: Baseline the two modules the new check uses.** `node spike/verify-elvanto-write.js > /tmp/b1-w.txt; echo $?; grep -c '^FAIL' /tmp/b1-w.txt`
  and `node spike/verify-sent-log.js > /tmp/b1-s.txt; echo $?; grep -c '^FAIL' /tmp/b1-s.txt`. Expected: exit `0` and
  `0` FAIL lines for each. (Both redirect `LOCALAPPDATA` themselves.)
- [ ] **Step 4: Copy** (byte copy, no editor; YS is the source of truth):
  ```bash
  mkdir -p spike/fixtures/ys-link
  cp C:/Users/ThomasPC/src/ys-connection/src/tests/fixtures/elvanto-link/*.json C:/Users/ThomasPC/src/wt-11.1-link/spike/fixtures/ys-link/
  ```
- [ ] **Step 5: Prove they are identical.** `diff -r --strip-trailing-cr /c/Users/ThomasPC/src/ys-connection/src/tests/fixtures/elvanto-link spike/fixtures/ys-link && echo SAME`
  Expected: `SAME`. `ls spike/fixtures/ys-link | wc -l` prints `11`.
- [ ] **Step 6: Hygiene scan** (the 11.1 publish leak scan, scoped to the new files):
  `grep -rniE "citipointe|ys-connection\.vercel|options\.com\.au|987tom1@|thomas@|[a-z0-9-]+\.elvanto\.com\.au" spike/fixtures/ys-link`.
  Expected: no output.
- [ ] **Step 7: Commit.**
  ```bash
  git add spike/fixtures/ys-link/*.json
  git commit -F - <<'EOF'
  test(ys-link): copy the YS Connection link contract fixtures (step 0)

  Byte copy of YS Connection src/tests/fixtures/elvanto-link/ (source of truth). Never edit here.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  EOF
  ```

### Task B2: `spike/verify-ys-link-contract.js`

**Files:** create `spike/verify-ys-link-contract.js`. It joins the suite by the `verify-*.js` rule, so no list needs editing.
**Depends on:** B1.
**Guardrails:** no push; no prod or Supabase MCP writes; **no live Elvanto: the session stub throws on any send, and
the reader is a stub**; never touch the main 11.1 checkout; never commit node_modules; explicit paths only; no
`src/` or `gui/` change (spec §9).

It checks the following. Each section number names the spec section it pins:
1. The manifest hashes and version (`CONTRACT_VERSION = 1` here for now).
2. For each claim row, the §5.2 mapping builds a writer input. `createWriter({ reader: stub, session: stub, verified: {} }).run(name, input)`
   answers **423** for it. `completeStep` goes through `complete()` with `sendVerified: false`. `checkOut` maps to no
   writer, and its capability is `off`. The check also asserts that nothing was sent and no sent-log line was written.
3. Every `result-request.json` outcome is in the §5.3 map copied here. **Spec gap:** `shadowed` is not a row of the §5.3
   table, because it comes from shadow mode (§7.2). The copied map therefore adds one row for §7.2. Without that row,
   §9's assertion cannot pass.

- [ ] **Step 1: Write the script:**
```js
// Step 0 contract check for the YS Connection link (YS Connection spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md,
// section 9). SAFE TO RUN: no network, no credential, no operator state. LOCALAPPDATA is redirected before the first require.
// spike/fixtures/ys-link/ is a byte copy of YS Connection's src/tests/fixtures/elvanto-link/ (YS is the source of truth; never
// edit them here). The section 5.2 mapping and 5.3 map below are the reference; the console stream moves them to src/ys-link.js.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ys-link-'));
const { createWriter } = require('../src/elvanto-write');
const { complete } = require('../src/elvanto-complete');
const sentLog = require('../src/sent-log');

const CONTRACT_VERSION = 1;
const DIR = path.join(__dirname, 'fixtures', 'ys-link');
const J = JSON.stringify;
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
let failed = 0;
function check(name, cond, detail = '') {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  <- ${detail}`}`);
}

// ---- Section 5.2 mapping (reference). -> { off } | { refused } | { name, input } | { complete, key, role }
const ROOM = { student: 'Youth Program', leader: 'Kids/Youth Team' }; // by roster kind, matched by room name; every first-timer is a student
const dmy = (ymd) => ymd.split('-').reverse().join('/');
const SIGN = / ?\n?— via YS Connection \([^)]*\)$/;
const withSign = (note, leader) => [note, `— via YS Connection (${leader})`].filter(Boolean).join('\n');
function toWriterCall(row, ctx) {
  const p = row.payload;
  if (row.type === 'checkOut') return { off: true }; // no check-out writer in 11.1 yet (spec 5.5)
  if (row.type === 'checkIn' || row.type === 'firstTimerCheckIn') {
    const person = row.type === 'checkIn' ? p.personId : ctx.approvedPerson(p);
    const room = ctx.service(p.serviceTimeId).rooms.find((r) => r.name === ROOM[row.type === 'checkIn' ? ctx.kindOf(person) : 'student']);
    if (!room) return { refused: 'no-room' };
    return { name: 'checkIn', input: { service: p.serviceId, serviceTime: p.serviceTimeId, person, room: room.id } };
  }
  if (row.type === 'completeStep') {
    const sel = ctx.completeForm(p.rowId).assignees.find((a) => a.selected); // the modal's pre-selected assignee
    return { complete: { row: p.rowId, note: withSign(row.note, row.by.leaderName), private: p.notePrivate, assignTo: sel ? sel.id : null, actions: [] },
      key: `complete:ys:${p.rowId}`, role: 'ys' };
  }
  const report = { group: p.groupId, date: dmy(p.date), didNotMeet: p.didNotMeet, attendees: p.didNotMeet ? [] : p.attendees,
    guests: p.guests, notesPrivate: p.notesPrivate };
  if (row.type === 'submitReport') {
    const offered = ctx.offered(p.groupId, report.date).filter((s) => s.value);
    if (!p.didNotMeet && offered.length > 1) return { refused: 'pick-service' };
    return { name: 'submitReport', input: { ...report, time: ctx.group(p.groupId).meets.replace(/^\S+\s+/, ''), // "Tue 6:30 PM" -> "6:30 PM"
      service: p.didNotMeet || !offered.length ? '' : offered[0].value, notes: withSign(row.note, row.by.leaderName) } };
  }
  // editReport: time + service as saved; Elvanto's notes kept and an old signature replaced (spec 7.1). The console stream
  // adds the report-changed (form != base) and note-too-long refusals.
  const f = ctx.reportForm(p.groupId, p.reportId);
  return { name: 'editReport', input: { ...report, report: p.reportId, time: f.time, service: p.didNotMeet ? '' : (f.selectedTimes[0] || ''),
    notes: [f.notes.replace(SIGN, ''), withSign(row.note, row.by.leaderName)].filter(Boolean).join('\n') } };
}

// ---- Section 5.3 outcome map (copied, first match wins) + the section 7.2 shadow row.
const OUTCOME_MAP = [
  ['200 { ok, at }', 'sent'],
  ['200 { already: true }; Already checked in; check-out not checked in', 'already'],
  ["sent === 'unknown', or an error with no sent", 'unclear'],
  ['busy, act-busy, sent-log', 'retry'],
  ['sent-log-blocked', 'unclear'],
  ['sent-log-stuck', 'already'],
  ['elvanto-shape/-timeout/-unavailable/-login, browser-launch with sent: false (refused console-cannot-read after 1 h)', 'retry'],
  ['bad-input with a known reason', 'refused'],
  ['bad-input with no reason', 'refused'],
  ['423', 'refused'],
  ['operator "It landed" / "It did not land" on a link key', 'resolved'],
  ['shadow mode (section 7.2): stops before the send', 'shadowed'],
];

async function main() {
  console.log('--- 1. manifest ---');
  const man = load('manifest.json');
  check('manifest contract version', man.contractVersion === CONTRACT_VERSION, String(man.contractVersion));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
  check('manifest lists every fixture', J(Object.keys(man.files).sort()) === J(files), J(files));
  for (const f of files) check(`${f} hash`, man.files[f] === crypto.createHash('sha256').update(J(load(f))).digest('hex'));

  console.log('\n--- 2. every claim row maps onto an 11.1 writer that answers 423 (validated, read first, built; nothing sent) ---');
  const roster = load('push-roster.json').rows;
  const services = load('push-services.json').rows;
  const groups = load('push-groups.json').rows;
  const ctx = {
    kindOf: (id) => (roster.find((r) => r.personId === id) || { kind: 'other' }).kind,
    approvedPerson: () => load('result-request.json').results.find((r) => r.personId).personId, // the person the console reports
    service: (st) => services.find((s) => s.serviceTimeId === st),
    group: (g) => groups.find((x) => x.groupId === g),
    offered: () => [{ value: '', label: 'No service' }],
    completeForm: (row) => ({ action: `/admin/flows/flow_people/?id=${row}&complete`, hidden: [], moveFields: [], actions: [], nextStep: null,
      assignName: 'assign_to', assignees: [{ id: roster.find((r) => r.kind === 'leader').personId, name: 'Leader', selected: true }] }),
    reportForm: (g, report) => {
      const grp = ctx.group(g), lr = grp.lastReport;
      const members = grp.members.map((m) => ({ id: m.personId, name: m.name }));
      if (!report) return { date: '', time: '', didNotMeet: false, guests: 0, notes: '', notesPrivate: false, members, attendance: [], selectedTimes: [], unkeptNotes: false };
      return { date: dmy(lr.date), time: lr.time, didNotMeet: lr.didNotMeet, guests: lr.guests, notes: 'Met at the park.\n— via YS Connection (Old Leader)',
        notesPrivate: false, members, attendance: lr.attendees, selectedTimes: lr.serviceTimeId ? [lr.serviceTimeId] : [], unkeptNotes: false };
    },
  };
  const reader = {
    checkinRooms: async (st) => ctx.service(st).rooms.map((r) => ({ ...r, count: 0 })), // count 0: no room page to read
    roomCheckins: async () => ({ count: 0, rows: [] }),
    groupReports: async (g) => { const lr = ctx.group(g).lastReport; return lr ? [{ id: lr.reportId, date: lr.date }] : []; },
    reportForm: async (g, report) => ctx.reportForm(g, report),
    reportServices: async (g, d) => ctx.offered(g, d),
    completeForm: async (row) => ctx.completeForm(row),
  };
  let sends = 0;
  const boom = async () => { sends++; throw new Error('the contract check must never send'); };
  const session = { postForm: boom, postPage: boom, postJson: boom, writeGet: boom, getText: boom };
  const writer = createWriter({ reader, session, verified: {} });

  const rows = load('claim-response.json').rows;
  check('claim rows: one per action type', rows.length === 6 && new Set(rows.map((r) => r.type)).size === 6, J(rows.map((r) => r.type)));
  for (const row of rows) {
    const call = toWriterCall(row, ctx);
    if (row.type === 'checkOut') { check('checkOut maps to no writer', call.off === true && !writer.names.includes('checkOut'), J(call)); continue; }
    let res = null, err = null;
    try {
      res = call.complete
        ? await complete({ reader, session, input: call.complete, key: call.key, role: call.role, sendVerified: false })
        : await writer.run(call.name, call.input);
    } catch (e) { err = e; }
    check(`${row.type} -> ${call.name || 'complete'} answers 423`, !!res && res.status === 423 && res.body.locked === true,
      err ? `${err.category}: ${err.message}` : J(res || call));
  }
  check('nothing was sent', sends === 0, String(sends));
  check('no sent-log line was written', sentLog.read().entries.length === 0, J(sentLog.read().entries));
  check('checkOut capability is off in the claim request', load('claim-request.json').capabilities.checkOut === 'off');

  console.log('\n--- 3. every result outcome is in the section 5.3 map ---');
  const mapped = new Set(OUTCOME_MAP.map(([, o]) => o));
  for (const r of load('result-request.json').results) check(`outcome ${r.outcome} is mapped`, mapped.has(r.outcome));
}

main().catch((e) => { failed++; console.error(e); }).finally(() => {
  console.log(failed ? `\n${failed} case(s) failed` : '\nall cases pass');
  process.exit(failed ? 1 : 0);
});
```
- [ ] **Step 2: Run it.** `node spike/verify-ys-link-contract.js; echo "exit $?"`
  Expected: 31 lines, every one `PASS`. That is 12 manifest lines (the version, the list, and 10 hashes), 10 lines in
  section 2 (one per type, 6 rows, and 3 nothing-sent/sent-log/capability lines) and 9 outcome lines. Then
  `all cases pass` and `exit 0`. If a writer throws `bad-input`, the message names the field.
  **Fix the mapping or the stub in this script. Never change `src/`, and never change a fixture here.** If a fixture
  itself is wrong, stop and tell the controller (the fix belongs to lane A).
- [ ] **Step 3: Prove it catches a change** (TDD for a test-only deliverable):
  (a) Change one character in `spike/fixtures/ys-link/push-flows.json`. Run it. Expected: `FAIL  push-flows.json hash`
  and `exit 1`. Restore it with `git checkout -- spike/fixtures/ys-link/push-flows.json`.
  (b) Temporarily change `'Youth Program'` in `ROOM` to `'Youth'`. Run it. Expected: the `checkIn` and
  `firstTimerCheckIn` lines FAIL and the script exits `1`. Revert the change. Run it again. Expected: `exit 0`.
- [ ] **Step 4: Neighbours still green.** Re-run `node spike/verify-elvanto-write.js` and `node spike/verify-sent-log.js`.
  Expected: exit `0` for each.
- [ ] **Step 5: Hygiene scan.** `grep -niE "citipointe|ys-connection\.vercel|options\.com\.au|987tom1@|thomas@|[a-z0-9-]+\.elvanto\.com\.au|ThomasPC" spike/verify-ys-link-contract.js`.
  Expected: no output.
- [ ] **Step 6: Commit.**
  ```bash
  git add spike/verify-ys-link-contract.js
  git commit -F - <<'EOF'
  test(ys-link): verify-ys-link-contract.js: fixtures map onto the writers (423, nothing sent)

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BcdvGpe1p8SZJQfeBhq4Wy
  EOF
  ```

---

## Task F1: Final verification (controller, both repos)

**Depends on:** A3 and B2. If A2 or A3 changed a fixture after A1, first re-run B1 steps 4 to 7 and B2 step 2.
**Guardrails:** no push; nothing in `supabase/migrations/`; no prod or Supabase MCP writes; no live Elvanto; never the
main 11.1 checkout; never commit node_modules. **No commit**, because this task changes nothing. Make any fix in its
lane task and commit it there.

- [ ] **YS green.** `cd /c/Users/ThomasPC/src/ys-connection && npx tsc --noEmit && npx vitest run`. Expected: green, and
  the file count is the A1 baseline + 1.
- [ ] **YS scope.** `git diff --stat 052bcc8..HEAD -- supabase public src/api src/services src/repositories vercel.json`.
  Expected: empty. `git diff --name-only 052bcc8..HEAD` lists only the spec, the draft SQL, this plan,
  `src/core/link-contract.ts`, `src/tests/link-contract.test.ts` and the 11 fixtures.
  `grep -n "LATEST_MIGRATION = '0015'" src/core/schema-version.ts` prints one line.
- [ ] **Fixtures in sync.** `diff -r --strip-trailing-cr src/tests/fixtures/elvanto-link /c/Users/ThomasPC/src/wt-11.1-link/spike/fixtures/ys-link && echo SAME`.
  Expected: `SAME`.
- [ ] **11.1 contract check.** `cd /c/Users/ThomasPC/src/wt-11.1-link && node spike/verify-ys-link-contract.js; echo "exit $?"`.
  Expected: `all cases pass`, `exit 0`.
- [ ] **11.1 full suite** (the repo's real test command, by rule; it runs offline). It takes several minutes. Run
  `verify-server.js` last and alone:
  ```bash
  cd /c/Users/ThomasPC/src/wt-11.1-link
  for f in spike/verify-*.js spike/drive-*.js; do
    case "$f" in *verify-smtp.js|*verify-credentials.js|*verify-server.js) continue;; esac
    node "$f" > /dev/null 2>&1 || echo "FAIL $f"
  done
  node spike/verify-server.js > /dev/null 2>&1 || echo "FAIL spike/verify-server.js"
  ```
  Expected: no `FAIL` lines (72 verify scripts and 3 drive scripts). If one fails, re-run it alone. It touches no file
  this plan changed, so a failure is pre-existing or caused by machine load (11.1 `CLAUDE.md`). Write it down; do not fix it here.
- [ ] **11.1 scope.** `git diff --stat 9833904..HEAD -- src gui scripts package.json`. Expected: empty.
  `git status --short`. Expected: clean (no `node_modules` line).
- [ ] **Nothing pushed.** In each repo, run `git log --oneline -6` and `git status -sb`. Expected: local commits only.
  No `git push` was run in this run.
- [ ] Leave the junction in place for the console orchestrator. If it is removed, use `cmd /c rmdir node_modules` only.

---

## Handoff notes

**YS Connection orchestrator (spec §10.1):**
- First feature commit: move the draft SQL to `supabase/migrations/0016_elvanto_link.sql` (or the next free number),
  bump `LATEST_MIGRATION`, and update the draft path in `src/tests/link-contract.test.ts` ("draft SQL" block) in the same commit.
- Import the schemas from `src/core/link-contract.ts`. Do not redeclare them. The `/sync` handler checks
  `body.contractVersion !== LINK_CONTRACT_VERSION` **before** `parse`, so a mismatch returns 409 `LINK_CONTRACT_MISMATCH`, not 400.
- Payload schemas are `.strict()` (the outbox never stores extra keys). Envelopes and push rows strip unknown keys.
  `ClaimRow.payload` is generic; parse it with `PAYLOAD_SCHEMAS[type]`.
- Not in step 0: the `/link/*` body schemas and their codes (`LINK_ID_REUSED`, `LINK_UNAVAILABLE`, `LINK_EDIT_IN_ELVANTO`,
  `LINK_DUPLICATE`, `LINK_TOO_LATE`). Add them to `link-contract.ts`.
- Grades are 7–12 (roster, first-timer), per the spec. If a ministry turns on "Include Grade 6", widen the range with a
  contract bump.

**Sync console orchestrator (spec §10.2):**
- Move `toWriterCall` and `OUTCOME_MAP` from `spike/verify-ys-link-contract.js` into `src/ys-link.js`. Point the verify
  script at that module so the 423 checks keep pinning it. The reference mapping leaves out the edit refusals
  (`report-changed`, `note-too-long`) and every `bad()` `reason`. Add them.
- The console sets any grade outside 7–12 to `null` before it pushes the roster. One bad row rejects the whole push.
- Never edit `spike/fixtures/ys-link/`. A contract change is made in YS (bump, fixtures, manifest) and copied with
  spec §9's `cp`. Both contract tests must be green in the same session.
- 11.1 `CLAUDE.md` says "71 verify scripts". With this script it is 72. Update the count the next time that file is edited.
- The worktree's `node_modules` is a junction into the main checkout. Remove it only with `cmd /c rmdir node_modules`.

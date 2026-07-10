# Task: build the Branding, Terminology & Modules editor screens in the Youth Ministry Setup wizard

> **STATUS: DONE (2026-07-11).** All three editors + a synthesised
> "Deploy to another church" hand-off guide were built into
> `renderMinistrySetup()` (public/index.html) and deployed. This file is kept as
> the spec/record. See CLAUDE.md's "Generalisation went LIVE + … Setup editors
> (2026-07-11)" section.

> Hand this whole file to a fresh Claude Code instance working in
> `Project 7 - Connection Made Simple/connection-made-simple`. It is a
> self-contained brief. Read `CLAUDE.md` first for the app's conventions.

## Background

**Connection Made Simple** ("Youth Connection") is a live youth-ministry platform
(TS/Express backend `src/` + a single phone-first SPA `public/index.html`).
Production auto-deploys from `master` → https://connection-made-simple.vercel.app
(Supabase project `ltcblcudlzlzfcyzlhpc`, Sydney).

A generalisation layer lets one codebase serve differently-shaped ministries via a
`ministryConfig` JSON blob stored on `app_settings.ministry_config`. The single
source of truth for its shape + defaults is **`src/core/ministry-config.ts`**
(`MinistryConfigSchema` / `MINISTRY_CONFIG_DEFAULTS`); the SPA mirrors those
defaults in **`MINISTRY_CONFIG_DEFAULTS_CLIENT`** (public/index.html ~line 4965).
An empty `{}` config means "current YS Brisbane behaviour, byte-identical."

Admins configure this through the **Youth Ministry Setup wizard**
(`renderMinistrySetup()` in public/index.html, ~line 5016), reached at
**Admin → Settings → Youth Ministry Setup**. The wizard has:
- **Step 0**: preset picker (`large-graded-au` / `small-flat` / `micro`).
- **Steps 1+**: fine-tuning cards. **Only two are built today**: `Structure` and
  `Roles` (they were the phase 6/7 deliverable). **Branding, Terminology and
  Modules are NOT built** — the wizard's Review step even says so ("Branding,
  terminology and module fine-tuning screens are still coming; the preset already
  set sensible values for those"). The values still exist and are set by the
  chosen preset; there is just no UI to edit them.

## Your job

Add three editor cards to the wizard's fine-tuning view (the `else` branch of
`renderMinistrySetup`, alongside the existing `Structure` and `Roles` cards, before
the `Review` card): **Branding**, **Terminology**, and **Modules**. Mirror the
existing cards' exact pattern — inputs/selects whose `onchange` calls
`_setupSet('dotted.path', this.value)` (or `_setupSetNum` for numbers), writing into
`_setupDraft`, which `saveMinistrySetup()` already PATCHes to `/settings`.

### Fields to expose (names + defaults from `src/core/ministry-config.ts`)

**Branding** (`branding.*`):
- `ministryName` (text, ≤60) — default "Youth Society Brisbane"
- `appName` (text, ≤40) — default "Youth Connection" (the app title/PWA name)
- `shortName` (text, ≤15) — default "Connection"
- `accent`, `accentDark`, `accentLight`, `navy` — 6-digit hex colours
  (`#1a1af2` etc.). Use `<input type="color">` where possible; validate hex.
- `logoSvg` (string, ≤20000, nullable) — raw SVG markup for the logo. **The
  backend already sanitises this** via `sanitiseLogoSvg()` in settings.service; the
  SPA renders it through `brandMark()` (public/index.html ~line 1411). A `<textarea>`
  is fine; consider a small live preview using `brandMark`.

**Terminology** (`labels.*`) — all plain text (≤40):
- `smallGroup` ("Lifegroup"), `smallGroupPlural` ("Lifegroups"),
  `service` ("Youth"), `serviceNight` ("Friday Nights"),
  `studentTeam` ("Student Team"), `connection` ("Connection")
- `groupNameStrip` (array of strings, default `["Brisbane - YS - "]`) — prefixes
  stripped from imported lifegroup names. Expose as a comma-or-newline textarea;
  split into an array in the handler (you may need a tiny `_setupSetList` helper,
  since `_setupSet` stores the raw value — an array must be stored, not a string).

**Modules** (`modules.*`):
- `connectionAudit` (bool) — default true
- `lifegroups` (bool) — default true
- `pushNotifications` (bool) — default false. **Leave togglable but note in a
  helpTip that push is currently hidden app-wide** (see CLAUDE.md "Notifications").
- `exportGuides` — `'elvanto'` (default) | `'hidden'` (select)

### How the app consumes these (so you can sanity-check live)

- Branding colours → `applyTheme(cfg)` (~line 705) sets CSS custom properties;
  `appName()`/`ministryName()` (~line 750) and `document.title`.
- Terminology → `L(key)` (~line 734) is the lookup used across the SPA.
- Modules → e.g. `modules.exportGuides` gates the Elvanto guide buttons;
  `connectionAudit`/`lifegroups` gate their nav/features.

`saveMinistrySetup()` already calls `applyTheme(fresh.ministryConfig)` after save.

## Hard constraints & gotchas (READ THESE)

1. **No backend work should be needed.** `PATCH /settings` (settings.service.ts) +
   `mergeMinistryConfig` already accept and validate any partial `ministryConfig`
   shape, deep-merging then re-running the full `MinistryConfigSchema`. If a field
   fails validation the whole save is rejected with a clear error — good. Do **not**
   loosen the schema.

2. **jsonb write bug — do NOT reintroduce it.** On 2026-07-11 a `ministry_config`
   save stored the config as a double-encoded jsonb *string*, which made every
   `/settings` read throw and **locked admins out of the whole app** (including this
   very Setup screen). Root cause: `` `${JSON.stringify(cfg)}::jsonb` `` — postgres.js
   sees the `::jsonb` cast, types the param as jsonb, and JSON.stringifies the
   already-stringified string again. **Always write jsonb via `sql.json(value)`**
   (see `supabase.settings.ts` / `supabase.connection-audit.ts`), never
   `JSON.stringify(x)::jsonb`. The read path is now resilient
   (`parseMinistryConfig`) — keep it that way. You almost certainly won't touch
   these files, but if you do, honour this.

3. **Keep the client mirror in sync.** Any new default must match between
   `MINISTRY_CONFIG_DEFAULTS` (server) and `MINISTRY_CONFIG_DEFAULTS_CLIENT` (SPA).
   Read current values in the editor with the same `x != null ? x : default`
   fallback pattern the Structure/Roles cards use.

4. **Persistent-shell caveat.** The header/nav are built once at login and only
   rebuild on re-login, and stats are cached ~60s server-side — so some branding/
   terminology changes only fully appear after logout/login. The Review help text
   already warns about this; no fix expected from you.

5. **Branch discipline.** Production auto-deploys from `master`. Work on a branch;
   do not push `master` unless the user explicitly asks to deploy. Migrations must
   stay additive (this task needs none).

6. **The invariant.** With `ministry_config = '{}'` the app must stay byte-identical
   to today. Your editors only change behaviour when an admin actually edits a value.

## Verification

- `npm run typecheck` (strict) and `npm run test` (should stay green; ~285 tests).
- SPA is one big inline `<script>` — syntax-check by extracting it (`node --check`)
  after editing; watch brace/quote balance in template literals.
- Local manual test: `PERSISTENCE=memory npm run dev` → http://localhost:4300, log
  in as `admin@youth.ministry` / `demo1234`, open Setup, edit each field, Save, and
  confirm it round-trips (title/colours/labels change; re-open Setup shows the saved
  values). Bump the SW cache name in `public/sw.js` if you change SPA assets.
- Optional: add a small test for any `groupNameStrip` array-parsing helper you add.

## Nice-to-haves (only if time)

- Live logo/theme preview in the Branding card.
- A 4th "Import" card (`import.dateOrder`, `import.leaderTag`) — same pattern; the
  schema already supports it. Out of the core ask but trivial to add here.

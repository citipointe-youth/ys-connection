# October rework: Simple logins, Prayers off, Bus read-only cars (design)

Date: 2026-10-12, revised the same day after the independent review
(`2026-10-12-oct-rework-review.md`). Branch `feat/oct-rework`, based on master `f105c46`. This rework ships
**before** the Elvanto link work.

Binding input: the operator decisions in `docs/superpowers/elvanto-link-progress.md` (link worktree), items 1–5
and 9, 10, 14 and 15.

> ## ⚠ MIGRATION NUMBER: this rework takes `0016`
> - This rework adds `supabase/migrations/0016_leader_view_grades.sql` and sets `LATEST_MIGRATION = '0016'`.
> - The Elvanto link branch renames its migration to **`0017`**. That is operator decision 15, and it is in the
>   link ledger.
> - The runner (`src/migrate/runner.ts`) records only the number. If two files share `0016`, prod applies the
>   first and **skips the second forever, without an error**.
> - This rework also adds a guard so that cannot happen silently (see "Migration guard" below).

Three parts, each behind its own switch:

| Part | Switch | Default |
|---|---|---|
| A. Simple logins (UI name: **Junior/Senior logins**) | new `ministryConfig.logins.simple` | off on existing installs; on for new installs |
| B. Prayers off | new `ministryConfig.modules.prayers` | on |
| C. Bus read-only cars | existing `modules.newYouthForms` (Off / Shadow / On) | off |

**Not in scope:**
- The More menu and the nav hub. Another instance owns them. Part B changes only how the Prayers slot resolves,
  in `navItems()` and the two slice helpers. More's sheet, `openMore()` and its styling do not change. Tell the
  More-menu owner about this change before it merges.
- The New person form.
- Anything in the Elvanto link.

---

## A. Simple logins

### What the operator sees when it is on
- **Quad logins are renamed.** `g79` becomes **Junior Girls**, `b79` **Junior Guys**, `g1012` **Senior Girls** and
  `b1012` **Senior Guys**. The new names show everywhere, including labels the server sends. Usernames and
  passwords do not change.
- **Grade logins are switched off** (`grade9g` and the rest) and hidden from Accounts. Switching Simple logins off
  again brings back exactly those accounts.
- **Quad logins lose Bus coordination:** Car setup, Assign, Generate and Move. A login whose "I am…" pick is a
  leader on the Bus coordinator list (`busMinistry.coordinatorLeaderIds`) still coordinates. **Fill that list
  first** (Rollout step 6).
- **Junior and Senior logins get a Grades filter.** It is saved on the server against the **leader** picked in
  "I am…". So it follows that leader to any phone or login, and it is still there after logout. Until the leader
  changes it, it shows that leader's own grades.

### Data model
1. **`ministryConfig.logins`.** It lives in `src/core/ministry-config.ts` and is stored in the existing
   `app_settings.ministry_config` jsonb, so it needs no migration.
   ```ts
   logins: z.object({
     simple: z.boolean().default(false),
     // SERVER-OWNED. Never taken from a client patch (see "Server-owned fields").
     retiredGradeIds: z.array(z.string()).default([]),
     gradeRoleWasOn: z.boolean().default(true),
   }).default({}),
   ```
   - The default is `false`, so every existing install (YS Brisbane too) is unchanged by the deploy.
   - Mirror only `logins.simple` in `MINISTRY_CONFIG_DEFAULTS_CLIENT`.
2. **New installs default to on.** `setup.service.ts` `createFirstAdmin()` writes this through
   `mergeMinistryConfig`:
   ```ts
   { logins: { simple: true, gradeRoleWasOn: true }, roles: { enabled: { grade: false } } }
   ```
   - The write happens **before** `users.createFirstAdmin(user)`. If setup then fails, the config left behind is
     harmless, and the next attempt still goes through.
   - Give the service the settings repo if it does not have it.
   - The memory seed (`src/seed.ts`) does not change.
3. **Migration `0016_leader_view_grades.sql`.** It is additive:
   ```sql
   alter table leaders add column if not exists view_grades int[];  -- null = "use the default"
   ```
   - `Leader` gets `viewGrades?: Grade[] | null`. The field is **optional**, so the existing `Leader` literals
     still compile: `import.service.ts:623`, `connection.service.ts` auto-create, `leader.service` create,
     `seed.ts`, and the tests.
   - `supabase.leaders.ts` `toLeader` reads the column.
   - Writes use a **new** repo method, `setViewGrades(id, grades)`, which updates only that column. The general
     `save`/`saveMany` upsert does **not** list `view_grades`, so no other write can wipe it.
   - Add the method to the in-memory and json repos as well.

### Server-owned fields (review C1)
`settings.service.ts` `update()` owns `retiredGradeIds` and `gradeRoleWasOn`:
- **It ignores them from clients.** It deletes `patch.ministryConfig.logins.retiredGradeIds` and
  `.gradeRoleWasOn` before `mergeMinistryConfig`, then carries the stored values forward. A client therefore
  cannot clear the list or plant ids in it, whether it comes from a stale Youth Setup draft, a second tab, a
  settings file or a raw `PATCH /settings`.
- **Only the on/off code below writes them.**
- **The SPA reloads the draft after each save.** After a successful `saveMinistrySetup()`, it sets
  `_setupDraft = null`, so the next edit is based on the saved config.
- **The settings file leaves them out.** `exportSettingsFile()` and `_parseSettingsFile()` drop both fields,
  because account ids belong to one location. `logins.simple` is still carried.

### Turning it on and off (`settings.service.ts` `update()`)
**Rule on every save.** Simple logins needs `structure.cohortModel = 'grades-quads'` and
`roles.enabled.quad = true`.
- A save that breaks the rule gets 400: "Turn off Junior/Senior logins first".
- While Simple logins is on, the server forces `roles.enabled.grade = false` after the merge.

**Off to on (review I4).** All of this happens before the write:
1. Read `ids`, the **active** `grade` users. Get them with `users.findByRole('grade')` and keep the active ones.
   This also catches active grade accounts when the Grade role was already off.
2. Write the settings **once**, with `logins.simple = true`, `retiredGradeIds = ids`,
   `gradeRoleWasOn = before.roles.enabled.grade` and `roles.enabled.grade = false`.
3. Deactivate exactly `ids`. Do not rely on the generic cascade for this. The generic cascade still runs if
   Grade flipped from true to false; it does the same thing, and running it twice is harmless.
4. Rename the quad accounts (see "Quad account names").

**On to off:**
1. Set `roles.enabled.grade = gradeRoleWasOn`.
2. Reactivate each id in `retiredGradeIds` whose user still exists, is still `role === 'grade'` and is still
   `inactive`. Every other id is skipped.
3. Clear the list in the same settings write.
4. Rename the quad accounts back.

**Quad account names (review I11).**
- Select accounts by `role === 'quad'` and the `quad` field, not by username. Usernames can be edited.
- On: rename to `quadLabelFor(quad, true)`. Off: rename to `QUAD_LABELS[quad]`, the one canonical en-dash
  string. `cohort-account-layout.ts` changes to use `QUAD_LABELS` too.
- The helper returns a count. The save toast says "Renamed N quad logins".
- A display name an admin typed by hand is overwritten in both directions. Display names are only labels.

**Server guard (review M8).** While Simple logins is on, `account.service` answers 400 "Turn off Junior/Senior
logins first" to:
- `create` of a `grade` account;
- `toggleStatus`/`update` that would make a `grade` account active.

**Live sessions.** A token carries its actor and is not checked against the DB again (`resolveToken`). So:
- A grade login that is already signed in keeps working for up to 12 h.
- A quad login keeps its old header badge until the app is reopened, because `_initShell` builds the badge once.

Flip the switch on a weekday, and tell users to reopen the app.

### Labels (review I3)
- **Server:** keep `QUAD_LABELS`. Add `quadLabelFor(quad, simple)` next to it in `src/core/types/enums.ts`.
  These call it with `cfg.logins.simple`:
  - `overview.service.ts:132`, `trends.service.ts:233` and `lifegroup-stats.service.ts:310`, the `byQuad[].label`
    values the SPA renders directly. Their 60 s caches are already cleared on every settings save.
  - `cohort-account-layout.ts` `buildTargetAccounts`.
- **Apply account layout (Complex) while Simple logins is on:** the target is the four quads only, with no grade
  accounts. Mirror this in `buildTargetAccountsClient`.
- **SPA:** `quadLabel(q)` returns the new name when `_simpleLoginsOn()`. Route every quad label through
  `quadLabel()`. Find the call sites with
  `grep -nE "QUAD_LABELS|QLBL|QUAD_LABELS_LOCAL|Girls Yr|Boys Yr|q\.label"` in `public/index.html`. That covers
  `quadChip` (~1429), the Connection Audit `QLBL` uses, the account-form option lists and the Home and Trends
  tiles. Where a server `label` is rendered, prefer `quadLabel(q.quad)`.

### RBAC change (quad and bus:coordinate)
`ROLE_PERMISSIONS` stays static. `access-control.ts` gains:
```ts
export function canWithConfig(actor: Actor, action: Action, cfg: Pick<MinistryConfig, 'logins'>): boolean {
  if (action === 'bus:coordinate' && actor.role === 'quad' && cfg.logins.simple) return false;
  return can(actor, action);
}
```
- `bus.service.ts` `allowed()` calls it in place of `can(...)`. The `coordinatorLeaderIds` elevation after it
  does not change.
- `allowed()` is the only path for `bus:coordinate`: `gate()` and `setDropped` both go through it.

### The grade filter
**Who gets it:** `quad` logins, while Simple logins is on. Admin and director keep today's grade and gender chips.

**Effective grades** (`_vgGrades()` in the SPA):
1. No "I am…" pick (`getMyLeaderId()` is empty): no filter. Show the whole bracket and the hint "Pick who you
   are on Home to filter by your grades".
2. Otherwise: `leader.viewGrades ?? leader.grades`, keeping only grades in `quadGrades(u.quad)`.
3. If that leaves nothing, show the whole bracket.

**YS Brisbane setup (decisions 2 and 14).** Nothing is copied. A leader with no saved filter defaults to
`leader.grades`. For example, Cody Codeman has `grades: [10]`, so on Senior Guys he sees Year 10 the first time.

**Saving:** `PATCH /leaders/:id/view-grades` with `{ grades: number[] | null }`.
- `null` means "back to my grades". The grades must be inside `gradeRange(structure)` and, for a quad caller,
  inside `quadGradesOf(actor.quad)`. Otherwise the answer is 400.
- **Who may write (review M3):** `canSetViewGrades(actor, leaderId)` in `access-control.ts`.
  - `quad`, `director` and `admin` may write any leader.
  - `leader` may write only its own `leaderId`.
  - `grade` gets 403.
- `/leaders` is already in all three allowlists. After a save the SPA updates its `/leaders` cache.

**Survives logout:** the filter is stored on the leader record. Logout still clears `yap_leader_id` and the
per-screen session filters, as today.

**Account preview (review I7):**
- While `_previewStash` is set, `_vgBar` changes stay in memory and are never saved, so looking at a login never
  changes a real leader's filter.
- `enterPreview` and `exitPreview` both clear `yap_leader_id`.
- In Shadow mode, a quad preview gets 404 on All cars. That is expected.

**UI (review M2):** one shared chip row, `_vgBar()`, reading `Grades: [7] [8] [9] · All · My grades`.
- Tap the grade chips to pick one or more.
- **All** saves the full bracket. **My grades** saves `null`.
- An empty pick is not saved: the last chip cannot be unticked.
- Saves are debounced by 600 ms.
- The row replaces those screens' own grade chips for Junior and Senior logins. It has no gender chips, because
  a quad login is one gender.

**Screens it narrows** (one rule each; review M4):

| Screen | Rule |
|---|---|
| Home | Only the quad's "Attendance by Grade" tiles and "Birthdays this week" are narrowed. Hero totals are not. |
| Health | Students whose `grade` is in the filter. |
| Connect Setup | Total/Connected/Pending and "Students not Connected" count filtered students only. A leader card shows if its `grades` overlap the filter, **or** it has `grades: []`. |
| Prayers | Student prayers by the student's grade. A general prayer shows if `createdByGrades` overlaps, **or** `createdByGrades` is null. |
| Upcoming Birthdays | Students whose `grade` is in the filter. |
| Student Search | Students whose `grade` is in the filter. |

**Not narrowed:** Home hero totals, Trends, My Connections, Bus and Connection Audit.

**It is a view preference, not security.** The server still limits every read to the quad's bracket and gender
(`canAccessStudent`).

### Youth Setup UI (review I6, I8)
- The Structure & Roles card gets a **Junior/Senior logins** toggle with a `helpTip`. Saving with it switched on
  shows a confirm:
  - "This turns off N grade logins and renames the quad logins to Junior/Senior Girls/Guys. Turning it off
    brings them back. Quad logins stop coordinating Bus."
  - If `coordinatorLeaderIds` is empty, the confirm adds a red warning: "No Bus coordinators are set. Only admin
    and director can run Bus."
- `confirmSaveMinistrySetup()` compares `logins.simple` and `modules.prayers` between the saved config and the
  draft. If either one changed, it shows that confirm, whatever caused the change: the toggle, a preset button or
  a loaded settings file.
- `pickMinistryPreset()` keeps the draft's `logins` and `modules.prayers`, so a preset never flips them on its
  own.
- While Simple logins is on, these are greyed out with a tooltip:
  - the Grade role checkbox;
  - the cohort-model select;
  - the Simple preset button.

---

## B. Prayers off

### Config and server
- **Config:** `modules.prayers: z.boolean().default(true)`, mirrored in the client defaults. It is a toggle in
  the Modules card.
- **Turning it off** opens a confirm: "Export prayers first? [Download CSV] [Turn off]". Download uses the
  existing `GET /prayers/export`.
- **Server:** every method in `prayer.service.ts` calls `requirePrayersModule()` first. The methods are `list`,
  `listByStudent`, `create`, `update`, `setStatus`, `remove`, `exportCsv` and `importCsv`.
  - It throws `ModuleDisabledError('Prayers')` (404) when the module is off.
  - With no `settingsRepo` (the optional 3rd argument), Prayers counts as on.
  - Export is also 404 while off. To export later, turn Prayers on, export, then turn it off again.
- **Data is kept.** A Full Reset still deletes prayers, as it does today.

### SPA, when off (`_prayersOn()`)
- `moreItems()` leaves out the Prayers entry.
- The leader Home quick-action grid (~2631) filters out `prayers`.
- `render()` sends `go('prayers')` to Home.
- `_prefetch` drops `/prayers`.
- My Connections skips the `/prayers` fetch, the per-student summary and the pray button (~3630).
- The student-profile "+ Prayer" button (~4510) is hidden.
- New Year Refresh shows the Prayers export and re-import as "skipped", and counts them as done (same as CA).
- **Logins that are already signed in (review M6):** if `/prayers` replies `MODULE_DISABLED`, the SPA:
  1. fetches `/settings` again;
  2. rebuilds the shell if `_navSig()` changed;
  3. calls `go('home')`.

### The Prayers slot (review I2; the More menu is not redesigned)
- `_navItemsBase()` **keeps** the `prayers` item in every role's list. It is the slot placeholder.
- `navItems()` resolves the slot from `moreItems()`, which already leaves out Prayers when it is off:

  | `moreItems()` entries | Slot shows |
  |---|---|
  | 2 or more | More (the existing item, unchanged) |
  | exactly 1 | that module as a plain tab: Prayers as today, or `{id:'bus', ic:'bus', label:L('busMinistry')}`, or `{id:'new-youth', ic:'plus', label:'New person', action:'nyOpen()'}` |
  | 0 | no slot |

- A new `_navSlots()` returns the resolved list with `null` where the slot is empty. Then:
  - `bottomNavItems() = _navSlots().slice(0, 5).filter(Boolean)`
  - `quickActionItems() = _navSlots().slice(5)`
  - `navItems() = _navSlots().filter(Boolean)`

  The split stays on the base index. So with no slot the bar shows 4 items, and no quick action moves up into
  it.
- A single-module tab is in the bottom bar, so `_isRootPage` treats it as a root page with no extra code.

---

## C. Bus read-only cars (under decision 1's switch)

### Who sees it
- **Coordinators** (decision 3): `admin`, `director`, and any login whose "I am…" leader is in
  `coordinatorLeaderIds`. While Simple logins is off, `quad` is still a coordinator by role.
- A new read-only **All cars** tab. Who can see it depends on the `modules.newYouthForms` mode:

  | Mode | Who sees All cars |
  |---|---|
  | Off | nobody (404) |
  | Shadow | `admin` only |
  | On | every login with `bus:use` |

- New helper in `access-control.ts`:
  `modeAllows(actor, mode) = mode === 'on' || (mode === 'shadow' && actor.role === 'admin')`.
  `canUseNewYouth` becomes `can(actor, 'intake:write') && modeAllows(...)`, which behaves the same as today.

### API
`GET /bus/run/cars` (`bus:use`, `bus.service.ts` `carsView(ctx)`). It answers 404 unless
`modeAllows(actor, newYouthForms)`. It ignores `as=`.
```ts
{ serviceDate, version, readOnly,
  cars: [{ name, colourIndex, leaderNames: string[],
           stops: [{ stop: number, name: string, grade: number | null, suburb: string, dropped: boolean }] }],
  unassigned: number }
```
- **Contents** (decision 9): car, leader names, stop order, rider name and grade, and suburb. Nothing else.
- **Source:** running run-vehicles and `ridingOf(run.id)`, sorted by `stopOrder`.
- **It never contains:**
  - any id (rider, student, guest, address or vehicle);
  - `placeId`, a street or a full address;
  - any phone;
  - consent or `droppedBy`;
  - the fleet or leader-pool lists.
- **`GET /bus/run`** gains `canSeeCars: boolean`, worked out with the same check.

### Suburb extraction (review C2)
No structured suburb is stored. Bus keeps only the formatted address string and an encrypted place id, and it
saves no Places address components. So the suburb comes from a new **strict** extractor in `bus-logic.ts`:
```ts
const STATES = 'QLD|NSW|VIC|SA|WA|TAS|NT|ACT';
const STREET_WORDS = /\b(st|street|rd|road|ave|avenue|ct|court|dr|drive|pde|parade|pl|place|cres|crescent|tce|terrace|hwy|highway|ln|lane|way|cl|close|cct|circuit|bvd|boulevard|esp|esplanade|unit|lot)\b/i;
export function suburbOnly(address: string): string {
  for (const part of address.split(',').map((p) => p.trim())) {
    const m = new RegExp(`^([A-Za-z][A-Za-z' .-]*?)\\s+(?:${STATES})\\s+\\d{4}$`).exec(part);
    if (m && !/\d/.test(m[1]!) && !STREET_WORDS.test(m[1]!)) return m[1]!.trim();
  }
  return '';  // unsure: blank, never a street
}
```
It takes only a comma-separated piece shaped like "Suburb STATE 1234". The suburb must contain no digit and no
street word.

| Input | Output |
|---|---|
| `"Unit 3, 24 Wynnum Rd, Carina QLD 4152, Australia"` | `"Carina"` |
| `"24 Wynnum Rd Carina QLD 4152"` (no comma) | `""` |
| `"24 Wynnum Rd"` (no suburb) | `""` |
| the one-space no-address sentinel | `""` |

- `carsView` uses `suburbOnly`.
- The junior-leader redaction in `buildView` switches to `suburbOnly` too, because it has the same leak.
- `suburbOf` stays as it is for coordinator and roster screens.

### What other logins can already see
Decision 10: grade and quad logins already see full bus addresses and phones through `bus:roster` and `as=`.
This is an accepted risk and out of scope.

### SPA (review M9)
- In `renderBus`, add `v.canSeeCars && { id: 'allcars', label: 'All cars' }` after My car.
- `_busAllCarsHtml()` shows one card per car:
  - a colour dot, the car name and the leader names;
  - the numbered stops, each with name, grade chip, suburb, and a tick when dropped.
  - There are no buttons.
- The data lives in its own `BUS.cars`, never in `BUS.view`.
- `busRefresh()` also fetches `/bus/run/cars` when `BUS.tab === 'allcars'`.
- `doLogout` clears `BUS.cars`.
- With Simple logins on, a quad login that has no coordinator pick sees My car, Students and All cars.

---

## Migration guard (review I10)
- `listMigrationFiles` / `runMigrations` throw `MigrationAbort` when two files share a version. The build then
  fails loudly; nothing is skipped quietly.
- `schema-version.test.ts` asserts that versions are unique.

## RBAC table (before → after)

| Login | bus:coordinate | Grade login usable | Grade filter | Prayers (off) | All cars (On) | Set view grades |
|---|---|---|---|---|---|---|
| admin | yes → yes | n/a | no (keeps chips) | 404 | yes (also Shadow) | any leader |
| director | yes → yes | n/a | no (keeps chips) | 404 | yes | any leader |
| quad, Simple off | yes → yes | n/a | no | 404 | yes | any leader |
| quad, Simple on | yes → **no** (yes if "I am" is a coordinator) | n/a | **yes (view only)** | 404 | yes | any leader |
| grade, Simple off | no → no (yes via coordinator list) | yes | no | 404 | yes | 403 |
| grade, Simple on | n/a | **no (off; server refuses re-enable)** | n/a | n/a | n/a | n/a |
| leader (junior) | no → no (yes via coordinator list) | n/a | no | 404 | yes | own only |

Server-side read scoping (`canAccessStudent`, the quad bracket and gender) does not change anywhere.

## Files touched (summary)
- **Core:**
  - `ministry-config.ts`: `logins`, `modules.prayers`.
  - `entities/leader.ts`: optional `viewGrades`.
  - `types/enums.ts`: `quadLabelFor`.
  - `schema-version.ts`: `'0016'`.
- **Migrations:** `0016_leader_view_grades.sql`. The duplicate guard goes in `src/migrate/runner.ts`.
- **Services:**
  - `access-control.ts`: `canWithConfig`, `modeAllows`, `canSetViewGrades`.
  - `settings.service.ts`: server-owned fields, on/off, the rule.
  - `setup.service.ts`.
  - `account.service.ts`: the grade guard.
  - `leader.service.ts`: `setViewGrades`.
  - `prayer.service.ts`.
  - `bus.service.ts`: `allowed`, `carsView`, `canSeeCars`, the redaction suburb.
  - `bus-logic.ts`: `suburbOnly`.
  - `cohort-account-layout.ts`.
  - `overview.service.ts`, `trends.service.ts`, `lifegroup-stats.service.ts`: labels.
- **Repos:** the leader interface, in-memory, json, and `supabase.leaders.ts` (`setViewGrades`, `toLeader`).
- **API:** `leader.controller.ts`, `bus.controller.ts`, and two `router.ts` routes under existing prefixes.
- **SPA `public/index.html`:**
  - config mirror, `quadLabel`, `_simpleLoginsOn`;
  - `_vgGrades` and `_vgBar` on six screens, plus the preview rules;
  - `_prayersOn` gating, the `MODULE_DISABLED` refresh, and `_navSlots`;
  - the Youth Setup toggles, confirm diff and preset keep;
  - `_setupDraft` reset after a save, and the settings-file strip;
  - the layout mirror and the All cars tab.
  - Run `node scripts/check-spa-syntax.js`.
- **`public/sw.js`:** bump `CACHE` once, at the end. `API_RE` does not change.
- **`CLAUDE.md`:** one short section per part. The "next migration" line becomes `0017`.

### Lanes (review M10)
| Lane | Work | Owns tests |
|---|---|---|
| 1 | core config, migration + guard, leader repos, `view-grades` API | `ministry-config`, `schema-version`, `leader.service` |
| 2 | settings on/off, setup, cohort layout, account guard, server labels | `settings.service`, `setup.service`, `cohort-account-layout`, `account.service` |
| 3 | prayers server | `prayer.service` |
| 4 | bus `carsView`, `modeAllows`, `suburbOnly`, `canWithConfig` | `bus.service`, `bus-logic`, `access-control` |
| 5 | SPA Part A | SPA tests for A |
| 6 | SPA Parts B and C, including `_navSlots` | SPA tests for B and C |

Lanes 1–4 can run in parallel. Lanes 5 and 6 merge one after the other; both edit `index.html`. The `sw.js` bump
comes last.

## Tests to add
- **`access-control.test.ts`:**
  - `canWithConfig`: quad and `bus:coordinate` with Simple on and off; every other role and action unchanged.
  - `modeAllows`.
  - `canUseNewYouth` unchanged.
  - `canSetViewGrades`: grade gets 403; a leader on another leader gets 403.
- **`ministry-config.test.ts`:** the defaults, and an old config that lacks the new keys still parses.
- **`settings.service.test.ts`:**
  - On: active grade ids are recorded **in the same write**, those ids are deactivated, Grade is off, and the
    quads are renamed by the `quad` field (a quad with an edited username is renamed too).
  - On when the Grade role was already off but an active grade account exists: that account is retired.
  - A patch carrying `retiredGradeIds: []` or `gradeRoleWasOn` while on does not change the stored values.
  - A patch carrying a foreign id is ignored.
  - Off: only listed ids that are still `inactive` **grade** users come back. A non-grade id and a deleted id
    are skipped. `gradeRoleWasOn` is restored.
  - `cohortModel: 'none'` or quad off while on: 400.
  - Ticking Grade back on while on: it stays off.
- **`setup.service.test.ts`:** stores `logins.simple = true` and `roles.enabled.grade = false`, and the settings
  write happens before the admin is created.
- **`account.service.test.ts`:** creating or unlocking a grade account while on gives 400.
- **Services:** `overview`, `trends` and `lifegroup-stats` return the new `byQuad[].label` while on.
- **`leader.service.test.ts`:**
  - `setViewGrades` checks the range and the bracket; `null` resets.
  - `updateSmsTemplate`, `updateGrades` and import `saveMany` leave `viewGrades` unchanged.
- **`prayer.service.test.ts`:** off means `ModuleDisabledError` from all 8 methods; with no `settingsRepo` it is
  on.
- **`bus-logic.test.ts`:** `suburbOnly` on the four cases in the table above, plus a normal
  `"8 Smith St, Carina QLD 4152, Australia"` that returns `"Carina"`.
- **`bus.service.test.ts`:**
  - Quad with Simple on: `canCoordinate = false`; Generate gives 403; `setDropped` on another car gives 403.
  - Quad with Simple on and a coordinator in `as=`: allowed.
  - `carsView`: 404 when Off; admin only in Shadow; every `bus:use` login when On. The output is the same with
    and without `as=`.
  - `GET /bus/run` `canSeeCars` for each mode.
  - **Key allow-list test.** Walk the whole `carsView` response:
    - Fail on any key outside `{serviceDate, version, readOnly, cars, name, colourIndex, leaderNames, stops, stop,
      grade, suburb, dropped, unassigned}`.
    - Fail if any `suburb` value contains a digit or matches `STREET_WORDS`.
    - Fail if any string value contains `streetOf(snapAddress)` or the full `snapAddress`.
    - Use the unit, no-comma and no-suburb fixtures.
  - Run the same `suburb` assertions on the junior-leader `buildView`.
- **`cohort-account-layout.test.ts`:** Complex with Simple on gives the 4 quads only, with the new names.
- **SPA tests** (the `extractFn` pattern):
  - `_navSlots` with Prayers on or off and 0, 1 or 2 other modules: More stays More, a single module becomes a
    plain tab, no slot means 4 in the bar, and the quick actions are unchanged.
  - `quadLabel` for both settings.
  - `_vgGrades`: no pick, default, saved, the bracket clamp, empty falls back to the bracket.
  - The `_vgBar` actions All and My grades.
  - Nothing is saved while `_previewStash` is set.
  - `enterPreview` and `exitPreview` clear `yap_leader_id`.
  - `pickMinistryPreset` keeps `logins` and `modules.prayers`.
  - `doLogout` does not clear the view grades and does clear `BUS.cars`.
- **Migrations:** the `schema-version` test passes with `0016`, and duplicate versions throw.

## Rollout
1. Build on `feat/oct-rework`, then run
   `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`.
2. **Deploy hazard.** `vercel-build` runs `scripts/migrate.ts` against the **prod** `DATABASE_URL` when
   `VERCEL_ENV=production`.
   - Preview pushes skip it.
   - **Every push to `master` runs `0016` on prod at build time, before the owner promotes.** This is safe:
     `0016` adds only a nullable column, and the live code never names it.
   - Never run `npm run migrate -- --force` with a prod URL.
   - After the push, read the build line `Database up to date — …` and tell the owner.
3. Merge to `master`, push, and the owner promotes. Then check:
   - `PATCH /leaders/x/view-grades` and `GET /bus/run/cars` without a login both give a **JSON 401**.
   - `/health` reports `schema.current = 0016`.
4. **After promotion nothing changes for YS Brisbane.** `logins.simple` is false and `prayers` is true. All cars
   shows only in Shadow (to admin) or On.
5. **Prayers:** export the CSV, then turn Prayers off.
6. **Simple logins.** Do this with the check-in release, on a weekday.
   - **Before you start:** put the Bus coordinators in Bus settings → coordinators, and check that each one can
     pick themselves in "I am…".
   - Then turn it on. Check that:
     - Accounts has no Grade section;
     - the save toast says "Renamed 4 quad logins";
     - the badge reads "Senior Guys" after the app is reopened;
     - on Senior Guys, picking Cody Codeman shows Year 10 in Health;
     - after logging in on another phone and picking Cody, it is still Year 10;
     - a quad login with no coordinator pick has no Assign tab;
     - a coordinator pick still gets Assign.
   - Tell users: reopen the app; the old grade logins stop within 12 h.
7. **Bus All cars:** test it in Shadow as admin on a Friday. Turn it On together with the other decision-1
   screens.
8. **Link branch:** it rebases onto this work with its migration as `0017` (decision 15). The duplicate guard
   catches a mistake.

## Review resolution
| Finding | Resolution |
|---|---|
| C1 retiredGradeIds clobbered or forged | Fixed. The server owns both fields and ignores them from patches. Restore needs inactive + `role === 'grade'` + in the list. The draft is reset after a save. Tests added. |
| C2 suburb leak | Fixed. Strict `suburbOnly` returns blank when unsure. It is used in `carsView` and the junior-leader redaction. Unit, no-comma and no-suburb tests added, and the key test checks for digits and street words. No structured suburb exists to use. |
| I1 rider names | Settled by decision 9: name and grade are shown. |
| I2 Prayers slot vs More | Fixed. The slot placeholder stays in the base list. More stays More when 2+ modules remain, one module becomes a plain tab, none means no slot. Bar and quick actions split on the base index. More itself is not redesigned. |
| I3 server quad labels | Fixed. `quadLabelFor` is used in the three services and the layout. The SPA routes all labels through `quadLabel()`. |
| I4 cascade gap / non-atomic ids | Fixed. Ids are collected before one settings write, then exactly those are deactivated. |
| I5 new-install inconsistency | Fixed. Setup writes `simple` and `grade:false`, and writes the settings before the admin. |
| I6 preset or file flips the switch | Fixed. The preset keeps the draft's `logins`/`prayers`; the save confirm diffs both; the UI label is "Junior/Senior logins". |
| I7 preview writes filters | Fixed. Nothing is saved during preview, and `yap_leader_id` is cleared on enter and exit. |
| I8 no coordinators after flip | Fixed. A rollout pre-flight step, and a warning in the confirm. |
| I9 existing bus paths | Accepted risk (decision 10). One line in C. |
| I10 duplicate migration numbers | Fixed. The runner throws, and a test asserts unique versions. Link renumbers (decision 15). |
| I11 rename by username | Fixed. Selected by `role` + `quad`, with a counted toast and one canonical en-dash string. |
| M1 one-time migration | Settled by decision 14: the default rule, no copy. |
| M2 "All" undefined | Fixed. All = full bracket; My grades = null; an empty pick is not saved. |
| M3 view-grades too open | Fixed. `canSetViewGrades`: quad/director/admin any leader, leader own only, grade 403. |
| M4 vague narrowing | Fixed. One rule per screen. |
| M5 Leader literals | Fixed. `viewGrades` is optional. |
| M6 signed-in users and Prayers off | Fixed. On `MODULE_DISABLED`, refetch settings, rebuild the nav and go home. |
| M7 stale badge | Fixed. Stated in rollout ("reopen the app"). |
| M8 grade accounts re-enabled | Fixed. The `account.service` guard. |
| M9 All cars refresh | Fixed. `BUS.cars`, the `busRefresh` branch and the logout clear. |
| M10 lane plan | Fixed. Lane table added. |
| Router-order note | Dropped. It was moot. |
| Optional: grade logins refused at `auth.login` while on | Deferred. The account guard plus deactivation cover it; the 12 h token tail is accepted. |

# October rework review: R7, speed and end-user feel

Reviewer R7. Branch `feat/oct-rework` at `720a0bc`, compared with `master...feat/oct-rework`. This was a read-only review.
I ran `npx vitest run src/tests/spa-oct-simple-logins.test.ts src/tests/bus.cars.test.ts`: 38 tests passed.

Counts: **Critical 0 · Important 3 · Minor 7**

Context used for the cost estimates (from the code and CLAUDE.md):
- Vercel region `syd1`, and `max: 2` Postgres connections per instance (`client.ts:36`).
- The Supavisor session pool is 15, so about 7 instances can hold connections at once.
- The SPA `Cache` TTL is 30 s, and `API.get` dedupes requests that are in flight.
- `dedupeReads` only merges **concurrent** no-argument reads. Two `getSettings()` calls made one after the other are two queries.

---

## Important

### I1. A grade-chip tap re-runs the page loader. On Home it causes network calls and a Follow Up flicker.
`public/index.html:1455-1462` (`_vgSet`), together with `render()` at `:2040` and `renderHome` at `:2419-2448`.

`_vgSet` calls the global `render()`, which runs the page's full loader again. The chip handlers that already existed do not do this:
- Connect Setup's `toggleAF` (`:3295-3299`) calls only the synchronous `renderConnectView()`.
- Student Search's `toggleSF` (`:4543-4547`) calls only `renderStudentView()`.
- CLAUDE.md, under "Collapsible dropdowns", says that Home toggles must not call `renderHome()`, because a lapsed cache causes a re-render flash.

**Failure scenario.** A quad login under Simple logins sits on Home for more than 30 s, then taps grade chip "8":
1. `renderHome` finds the cache stale and takes the `haveStale` branch. It paints from stale data, which is correct.
2. It calls `_revalidateHome()`. That sends `GET /batch?sections=lifegroupStats,overview,students,trends`. The `students` section is not response-cached on the server, so every tap does a full `students.findAll()` plus decryption of the phone fields.
3. `setApp` replaces `#home-followup`, and `renderHomeFollowup()` (`:2757`) calls `API.get('/connections/leader/:id/followup')`. That entry is also older than its 30 s TTL, so it is a network call. The Follow Up card is blank until the call returns. The followup service does about 6 reads.
4. When the batch lands, `_renderHomeInner(false)` repaints the whole page a second time.

Result: one tap causes 2 serverless invocations, 2 full repaints and a flicker of the Follow Up card. Tapping through 7 → 8 → 9 on a Friday repeats this. The `_homeRevalidating` guard merges only the batch requests that overlap in time.

Connect Setup has the same problem. `render()` → `renderConnect()` (`:3107-3120`) → `_revalidateConnect()` sends a 3-section `/batch` (`studentsConnect`, `leaders`, `connectionsConnect`) and repaints twice. A tap on the old chips cost no request.

Student Search has the same problem: `renderStudents` → `_revalidateStudents`.

Health, Prayers and Birthdays are **not** regressions. Their own chip handlers (`setArFilter`, `setPrayerFilter`, `setBdayFilter`) already call the page loader.

**Fix.** Add a `_vgRepaint()` that repaints from the cache only, and call it from `_vgSet` in place of `render()`. It should dispatch on `S.page`:

| Page | Repaint call |
|---|---|
| `leaders` | `renderConnectView()` |
| `students` | `renderStudentView()` |
| `home` | `_renderHomeInner(true)` with a flag that reuses the last followup HTML (or keeps `#home-followup`'s current `innerHTML`) and does not fetch it again |
| `at-risk` | `renderAtRisk()` (unchanged) |
| `prayers` | `setApp(shell(_prayersHtml(_prayerCache)))` |
| `birthdays` | `renderUpcomingBirthdays()` (unchanged) |

### I2. Picking (or clearing) "I am…" on Home does not apply the grade filter until the user leaves Home
`public/index.html:2895-2900` (`chooseHomeLeader`) and `:2809` (the "Not you?" button). Both call only `renderHomeFollowup()`.

`_vgGrades()` reads `getMyLeaderId()`, but these handlers repaint only `#home-followup`. Three parts of the page are left stale:
- the `_vgBar`, which is painted by `_renderHomeInner` at `:2711`;
- the quad "Attendance by Grade" tiles (`:2713`, `_vgGradeList`);
- `_homeBirthdaysCtx`, which is computed once at `:2529-2530`.

**Failure scenario A.** A Senior Girls login has no pick yet. Home shows disabled chips and the hint "Pick who you are on Home to filter by your grades". She picks "Jess", whose `grades` is [11]:
- The Follow Up card updates.
- The chip row still shows the disabled bar and the hint.
- The tiles still show grades 10, 11 and 12.
- "Birthdays this week", which `renderHomeFollowup` reads from the stale `_homeBirthdaysCtx`, still lists the whole bracket.

Nothing changes until she leaves Home and comes back.

**Failure scenario B.** She taps "Not you?". `yap_leader_id` is removed, but the enabled chips for Jess stay on screen. A tap on them does nothing: `_vgToggle` → `_vgGrades()` returns null (`:1492-1493`), and `_vgSet` returns early when there is no id.

**Fix.** After `setMyLeaderId(...)` in both handlers, when `_vgActive()`, repaint Home from the cache with the same cache-only `_renderHomeInner(true)` path as I1. That repaint also recomputes `_homeBirthdaysCtx` and runs `renderHomeFollowup`.

### I3. The All cars tab adds a third heavy Bus request on every refresh. It applies once `newYouthForms` = `on`.
- `public/index.html:8671-8672` (`busRefresh`)
- `:8995` (the tab click runs `renderBus();busRefresh()`)
- `src/services/bus.service.ts:683-703` (`carsView`)

While `BUS.tab === 'allcars'`, every `busRefresh` sends `/bus/run`, `/bus/my-car` **and** `/bus/run/cars` in parallel. Before this change it sent 2. `setDropped` (`bus.service.ts:1090-1103`) calls `touch()`, so every "Dropped off" tap bumps the run version. The 10 s poll then sends `busRefresh` from **every** phone on the Bus page.

**Failure scenario.** A drop-off Friday, with 10 leaders watching All cars and a drop-off about every 30 s:
- 10 phones × 3 invocations per version change = 30 invocations, against 20 before.
- Each invocation runs `gate()` (`getSettings`) → `getRunByDate` before any real work.
- `/bus/run` alone (`buildView`, `:364-366`) fans out to about 8 reads.
- `carsView` re-reads data that `/bus/run` has just loaded: vehicles, riders and `leaders.findAll`. It also calls `listRunRiders(run.id)` **twice** in one request: once in `ridingOf` (`:688`) and once inside `vehicleViews` (`:343`). The argument-keyed read is not deduped, so the encrypted snapshot addresses are decrypted twice.
- Its chain is 4 stages in a row (settings → run → leaders, riders and riders in parallel → `listRunVehicles`), on an instance with only 2 connections.

With the pool at 15, this extra 50% of Bus invocations is what pushes waiting connections past the route timeout. Also, opening the tab re-fetches the full run view and My car even though only the cars list is needed.

Today, prod has New person Off, so `canSeeCars` is false for everyone. The cost appears when New person is turned On (`modules.newYouthForms` = `on`), because `canSeeCars` is tied to that same switch.

**Fix.**
- Build the `cars` block inside `buildView` from the `vehicles` and `riders` that it already loads (zero extra queries). Send it only when `canSeeCars` and the client asks for it (`GET /bus/run?cars=1`). Then remove the third request from `busRefresh`.
- Make the tab click a cache-only `renderBus()`, plus a fetch only when `BUS.cars` is null.
- If the separate route stays, reuse the `riders` array in `vehicleViews`, so `listRunRiders` runs once.

---

## Minor

### M1. On a cold open, Home sends an extra `GET /leaders` and the grade tiles visibly jump (Plausible: depends on timing)
`public/index.html:1505-1509` (`_vgBar`), `:1345` (`_prefetch` inside `_initShell`) and `:2440-2446` (Home cold load).

`boot()` → `render()` → `_initShell()` fires the 8-section prefetch `/batch` and does not wait for it. Home's cold path then awaits its own smaller 4-section `/batch`, which usually returns first. When Home paints, `/leaders` is not in the cache yet:
- `_vgGrades()` falls back to the whole bracket (`:1447-1451`, because `l` is null).
- `_vgBar` sends a separate `GET /leaders`. It is not deduped with the batch's leaders section.
- When `GET /leaders` resolves, `render()` paints Home a second time with the narrower grades.

This affects any quad login that reopens the PWA with a saved "I am". The cost is 1 extra invocation per Friday app open, plus tiles that change from 10/11/12 to 11.

**Fix.** When `_vgActive() && getMyLeaderId()`, add `'/leaders'` to `HOME_PATHS()`. It is already a batch section, so the cost is 0 extra requests.

### M2. The Prayers service now reads settings twice, one read after the other
`src/services/prayer.service.ts:52-57` and `:110-113` (also `:147-149`, `:156-160`, and update/setStatus/remove).

`await requirePrayersModule()` (`getSettings`) finishes before `Promise.all([...structureScope()])` starts. That makes a second `getSettings` query. The two are not concurrent, so `dedupeReads` does not merge them.

Every `/prayers` load now waits one extra round trip and runs 2 settings queries where it ran 1. It is only a few ms in `syd1`, but `/prayers` loads on login (`_prefetch`) and on every My Connections render.

**Fix.** Read settings once, for example `const cfg = await settingsRepo.getSettings()`, then check `modules.prayers` and take `structure` from that one result.

### M3. `setViewGrades` makes 4 database round trips in a row
`src/services/leader.service.ts:214-237`.

The sequence is `findById` → `getSettings` → `setViewGrades` → `findById` again. The save is debounced by 600 ms and is off the paint path, so the user feels little. Still, each save holds a connection for 4 round trips.

**Fix.** Run `findById` and `getSettings` in `Promise.all`. Return `{ ...existing, viewGrades: grades }` instead of reading the row again.

### M4. Turning Prayers off sends every active phone through a full shell rebuild and prefetch, and takes the user away from the page they are on
`public/index.html:1365-1373` (`_moduleDisabledRefresh`) → `_initShell()` → `_prefetch()` (`:1345`, which always sends the 8-section `/batch`; `API.batch` never checks the cache for batchable paths), then `go('home')`.

**Failure scenario.** An admin turns Prayers off mid-Friday. Each logged-in phone still has the old settings, so its next `/prayers` call returns `MODULE_DISABLED`. My Connections calls `/prayers` on every render (`:3776`). The result per phone:
- `GET /settings`, the full prefetch batch, `/import/history` and a Home batch;
- the leader on My Connections is moved to Home, because the best-effort prayer summary failed.

This is a one-time burst per phone. **Fix.** Skip `go('home')` unless `S.page === 'prayers'`. The `_initShell` prefetch is acceptable, but it could pass a flag that skips `_prefetch`.

### M5. Logging out does not cancel a pending grade-filter save
`public/index.html:2241` (`doLogout`, which never calls `_vgReset()`) and `:1460-1461`.

If a user taps a chip and logs out within 600 ms, `_vgSave` fires after logout. It sends `PATCH /leaders/:id/view-grades` with no token, gets a 401, and the login screen shows a stray toast. `_vgLocal` also survives into the next session on that shared device.

**Fix.** Call `_vgReset()` in `doLogout`.

### M6. All cars stays on "Loading…" if its first fetch fails
`public/index.html:8672`, where `.catch(() => null)` leaves `BUS.cars` null, and `:9004`.

The poll calls `busRefresh` only when the run version changes (`:8700`). A failure such as a 503 on the first `/bus/run/cars` call therefore leaves "Loading…" on screen until someone else edits the run.

**Fix.** Show "Couldn't load. Tap to retry" when the fetch fails and `BUS.cars` is still null.

### M7. Flipping Simple logins is a run of serial writes (admin only)
`src/services/settings.service.ts:166-175` and `:47-55` (`renameQuads`).

Each retired or restored grade login costs `findById` then `save`, one after the other, and each quad rename is a further serial `save`. That is about 12 grade logins plus 4 quads, so roughly 28 round trips inside the 20 s route budget. It is fine at today's size and it is an admin-only action.

**Fix (optional).** Reuse the `findByRole('grade')` result instead of `findById` per id, and run the saves in `Promise.all`.

---

## Verified OK

- **`/batch` is still the main transport.** `_prefetch` (`:1356`), Home cold load and all `_revalidate*` helpers still call `API.batch`. `/prayers` was already a passthrough GET on master, so dropping it when the module is off saves a request.
- **No full-shell rebuild on a filter change.** `_vgSet` → `render()` runs only `_updateNavActive()`, and `_initShell` runs only when `!_shellReady`. `setApp` keeps the scroll position on the same page. The cost is the page-loader re-run in I1, not a shell rebuild.
- **The filter applies on the phone without a reload.** `_vgSet` updates `_vgLocal` and repaints straight away, then saves after 600 ms. `_vgSave` changes the cached `/leaders` entry in place and does not fetch it again. A tap made during a save keeps its local override. The exception is the Home "I am" path in I2.
- **`_vgBar`'s `/leaders` fetch runs only when `getStale('/leaders')` is null**, and `API.get`'s `_inflight` map merges repeat calls. Normally the prefetch batch has already loaded `/leaders`. The one leak is the cold-open race in M1.
- **Hot screens:**
  - My Connections makes no new request. `/prayers` is now skipped when the module is off.
  - Health and Prayers make no new request; they use the existing `/students` and `/prayers` paths.
  - Home makes no new request on a warm cache.
  - No new awaits run one after another on the client.
- **Account preview never saves a filter** (`:1460`). Entering or leaving a preview clears the "I am" pick and `_vgLocal`.
- **`getSettings` reads before it writes.** `supabase.settings.ts:87-97` does a `select` first, so a per-request settings read is one indexed single-row select. The settings reads in Bus `gate()` already existed on master.
- **The quad label changes cost nothing on the server.** overview, trends and lifegroup-stats reuse the settings they already load, and their response caches are unchanged.
- **The `view_grades` column adds no query.** It arrives through the existing `select *` in `toLeader`. Only the dedicated `setViewGrades` writes it, so a leader upsert or import is not slowed.
- **`/bus/run/cars` is fetched only while the All cars tab is open**, and a failure there never breaks My car or the run view.
- **Tests.** `src/tests/spa-oct-simple-logins.test.ts` and `src/tests/bus.cars.test.ts` pass (38 tests).

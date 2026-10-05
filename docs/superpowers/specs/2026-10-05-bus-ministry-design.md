# Bus Ministry — design

**Date:** 2026-10-05 · **Status:** approved in brainstorming, awaiting written-spec review
**Mockup (visual reference):** `_design/bus-ministry-mockup.html` (published: https://claude.ai/artifact/1pbjvHvTcvJTFBwkEMkTsK). Reviews: `_design/review-ux.md`, `_design/review-colour.md`, `_design/car-setup-review.md`.

## 1. Purpose

After youth night, 3–5 cars (6–15 seats) drive youth home across the city. Today a leader types
addresses into Google Maps and reorders pins by hand. Bus Ministry replaces that: leaders add
who's on the bus (mostly ~7pm on the night), a coordinator taps **Generate routes**, and each
car's leaders open **My car** to see their ordered stops, tap-to-call student mobiles, and start
Google Maps navigation. Success = from "who's on the bus" to "every car has an ordered route its
leaders can see" in a couple of minutes.

It is a **self-contained, optional module** of YS Connection, usable by any ministry.

## 2. Build rules (apply to every plan/task)

- **Ponytail**: simplest working code; reuse existing helpers (`field-crypto`, `ModuleDisabledError`,
  `.drop` cards, `modal()`, `phoneLink`/`callPhone`, `getMyLeaderId()`, `extractFn` tests,
  `sql.json()` for jsonb). **No new npm dependencies** — Google APIs via plain `fetch`; the
  service-account JWT is signed with `node:crypto`.
- **Token efficiency**: plans batch related mechanical work into a few larger Sonnet tasks.
- **Ministry-agnostic**: no YS Brisbane defaults in code or config. Module label `labels.busMinistry`
  (default "Bus Ministry"); grades/genders from `structure`; church address etc. empty until set.
- **Screen sizes**: phone portrait is the base; existing landscape rule (`max-height:500px`);
  ≥768px: Routes shows cars as columns, Route analysis puts map beside the list;
  `(pointer:coarse)` ≥44px tap targets; safe-area insets respected.
- **Icons**: SVG line icons in the `IC` registry only (new: `bus`, `phone`, `pin`, `map`, `route`,
  `pinned`, `kebab`). No emoji/unicode symbols.
- **Colour = attention**: amber (warn) = needs action (Unassigned > 0, car needs a leader, leader
  gender unknown, pending new people); accent = neutral info (e.g. tonight-only override); grey is
  reserved for "unassigned" and never given to a car; critical states always pair colour with an
  icon or text. Car identity colours appear only where placement matters (Routes, roster pill).
- **Docs at the end, concise**: one short CLAUDE.md section + debug.md entries for real gotchas only.
- **Delivery**: branch `bus-ministry`, three plans executed back-to-back, merged to `master` once
  after the owner tests the complete feature locally. Ships with the module **off**.

## 3. Scope and releases (one spec, three plans, one merge)

1. **Core** — module toggle + visibility, roster, walk-ins (+ import linking, 28-day purge),
   Car setup (fleet, running tonight, fixed leaders, leader pool, Ends at), manual placement (Move),
   My car (incl. leaders' own cars), run history, edit-together mechanics. Works with **no Google**.
2. **Google** — address autocomplete + place IDs, Generate / Fit in / Re-generate all, pool
   auto-fill, gender/grade penalties, Undo, Maps links.
3. **Route analysis** — per-rider detour, +1/+2 cars, static route map.

## 4. Roles and permissions

| Capability | grade | quad | director | admin | Bus coordinator* |
|---|---|---|---|---|---|
| Roster: search any student, add/edit/remove, New Person | ✓ | ✓ | ✓ | ✓ | ✓ |
| Car setup, Generate, Fit in, Move, Undo | | ✓ | ✓ | ✓ | ✓ |
| My car (+ add own car) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Route analysis, Past nights | | | ✓ | ✓ | |
| Bus settings | | | | ✓ | |

- `leader` (junior) logins: **My car only**.
- *Bus coordinator = the self-identified leader (`getMyLeaderId()`, sent as `X-Bus-Leader`) is in
  `busMinistry.coordinatorLeaderIds`. **Convenience, not a security control** — anyone can change
  their self-identity; the owner accepts this.
- Bus Ministry ignores normal grade/gender scoping for its own reads (a quad routes both genders),
  but bus search returns only **name, grade, gender, saved-address labels**.
- `busMinistry.visibility: 'admin' | 'all'` (default `'admin'`) gates everything to admin during
  build/test. RBAC lives in `access-control.ts` as new `bus:*` actions.

## 5. Data model (migration `0011_bus_ministry.sql`; no existing table altered)

All tables RLS-enabled with no policies (app connects as owner). `enc` = AES-256-GCM via
`field-crypto` (AAD `bus_<table>:<column>:<id>`), encoded/decoded only in the Supabase repos.

| Table | Columns (abridged) |
|---|---|
| `bus_vehicles` | id, name, plate, seats, pref_grades int[], ends_at ('church'\|'last_drop'\|'address'), ends_address enc, ends_place_id enc, sort, archived |
| `bus_leader_prefs` | leader_id PK → leaders ON DELETE CASCADE, in_pool bool, fixed_vehicle_id, own_car jsonb (name/seats/plate/ends_at; address fields enc), last_own_rider_ids jsonb |
| `bus_guests` | id, first_name, last_name, grade, gender, phone enc, linked_student_id, dismissed bool, created_at, last_ridden_at |
| `bus_addresses` | id, student_id → students ON DELETE CASCADE \| guest_id → bus_guests ON DELETE CASCADE, label, address enc, place_id enc, last_used_at |
| `bus_runs` | id, service_date UNIQUE, version int, available_pool_leader_ids jsonb, lock_by, lock_until, last_change_by, last_change_at, undo_snapshot jsonb, undo_until |
| `bus_run_vehicles` | id, run_id, vehicle_id NULL (own car) \| owner_leader_id, name, seats, plate, running, leader_ids jsonb, ends_at + address enc (tonight value, copied/overridable), colour_index |
| `bus_run_riders` | id, run_id, student_id \| guest_id, address_id, run_vehicle_id NULL, stop_order, pinned, added_by, added_at, snap_name enc, snap_grade, snap_address enc |

- **No coordinates are stored** (Google terms allow caching lat/lng ≤30 days; place IDs forever).
- **Which run**: adding always targets the run for the next service day (`structure.serviceDayOfWeek`);
  a run whose date has passed is read-only history. A new run copies the previous run's vehicles
  (running flags, leaders, Ends at) and pool availability.
- **Snapshots** (`snap_*`) keep history readable after the New Year Full Reset deletes students.
  A student's saved addresses are deleted with the student (cascade) — fresh year, clean slate.
- **Bus settings** live in `ministryConfig.busMinistry` (written with `sql.json`): visibility,
  churchAddress, churchPlaceId, leaveTime ("21:00"), targetRouteMin (45), prefWeightMin (10),
  genderWeightMin (120), detourMin (10), detourPct (20), coordinatorLeaderIds. `modules.busMinistry`
  (default `false`) and `labels.busMinistry` are added to `MinistryConfigSchema`; Youth Setup →
  Modules gains the one toggle.

## 6. Screens (see mockup for layout)

- **Home tile** (below hero): bus icon · label · "14 riders · 3 cars".
- **Bus Ministry**: date header, gear (admin → Bus settings), "Past" (director/admin). Tabs by role:
  Roster · Car setup · Routes · My car. Header line "Last change: Sarah · 7:04pm".
- **Roster**: search any student; results only while typing; "On the bus tonight" list; car-name
  pill once placed; remove (trash, confirm). Picking a student **always** opens the address sheet:
  saved addresses (most recent first) + "New address" (Google autocomplete, AU only, + label).
  No search match → **New Person: "…"** → first/last name, grade, gender (starts unselected),
  phone → address sheet.
- **Car setup**: running toggle per saved vehicle; "12 seats · 2 leaders · 10 for youth";
  read-only "Riders this car can take" from leader genders; amber "needs 1 · auto-fill from pool"
  under 2 leaders; Ends at; fixed leaders; **Leader pool — available tonight** (tick + gender icon);
  read-only **Own cars tonight**. Edit vehicle sheet: name, plate, seats, preferred grades
  (multi-select), fixed leaders, Ends at (one control: Church / Last drop / Address + "Tonight
  only"), archive.
- **Routes**: primary **Generate routes** → after first generate **Fit in N new riders**; kebab
  menu → Re-generate all. Lock banner "Sarah is generating routes…" (buttons disabled). Undo toast
  (2 min). Unassigned (amber while > 0, "All placed" at 0). Per-car card: colour, name,
  "9/10 · 48 min", leader tags, ordered stops, pin icon on manually placed riders. Tap rider →
  Move sheet (cars with seats left, Unassigned). ≥768px: cars as columns.
- **My car**: "I am: Tom · Not you?"; car + co-leaders; Start in Google Maps (split "Stops 1–9 /
  10–N" only when > 9 stops); ordered stops, tap to reveal street address, phone button = student
  mobile. Not on a car → **Driving your own car?** sheet: pre-filled from last week (car details,
  last week's riders pre-ticked), rider picker from tonight's roster, "These riders come off the
  bus routes."
- **Route analysis** (director/admin): static map of all routes; per car, riders ranked by detour
  with bars, amber over threshold; Try +1 / +2 cars (seats each) → result lines.
- **Admin/director "New people" card** (Admin screen): walk-ins with name, grade, phone, added date;
  "Is this Riley Kim (Y10)? Yes / No" for possible matches; otherwise "Clears when imported or after
  28 days" + Dismiss.

## 7. Behaviour

**Edit-together.** Every roster/move/vehicle change is a small independent server action (last
write wins per row; additions never clash). Each write bumps `bus_runs.version`. Open bus screens
poll `GET /bus/run/version` every 10 s and refetch only when it changed. Generate/Fit in/Re-generate
take a **lock** (`lock_by`, `lock_until = now+30s`, conditional update); others see the banner and
disabled buttons; lock auto-expires. Riders added during a lock are simply unplaced → next Fit in.
**Undo**: before any generate the run's placements are saved to `undo_snapshot`; Undo restores
them within 2 minutes. `last_change_by` = self-identified leader name, else account display name.

**Walk-ins.** Stored as `bus_guests` until linked. After every CSV import (`import.service` calls
`busService.linkGuests()`), each unlinked guest is matched to students by normalised first+last
name: exactly one match → link, move their saved addresses to the student, clear. Several or
near matches (first-name prefix, e.g. Jess/Jessica) → "Is this them?" on the New people card.
**28-day purge**, lazily on any bus read: unlinked guests with `last_ridden_at` older than 28 days
are deleted (phone + addresses go; past-run snapshots keep the name).

**Own cars.** A leader's own car is a `bus_run_vehicles` row with `owner_leader_id`; its riders are
excluded from fleet solving; it gets its own single-vehicle ordering (Release 2) and Maps link.
Details + rider ids saved to `bus_leader_prefs` for next week's pre-fill (lost at Full Reset,
since leaders are deleted then).

**Generation (Release 2).** Google Route Optimization `optimizeTours`, one shipment per placed-able
rider (delivery at place ID). Vehicles: running fleet cars with capacity = seats − leaders,
start = church, end per Ends at (church / none / address). Leave time = run date + `leaveTime`.
Objective: minimise total time + quadratic soft cap at `targetRouteMin` per car. Penalties
(`costsPerVehicle`): rider in a car whose leaders don't cover their gender = `genderWeightMin`
(strong preference; broken only when seats run out → car shows a warning); grade outside a car's
`pref_grades` = `prefWeightMin`. **Pool auto-fill first**: fixed leaders stay; each car under 2
leaders takes pool leaders (available tonight) chosen so seats able to take girls/boys roughly
match tonight's roster split. Modes: Generate/Re-generate all = everyone except pinned (pinned →
`allowedVehicleIndices` = their car); Fit in = only unplaced riders, placed riders fixed to their
car. Not enough seats → leftovers stay Unassigned with an amber warning. Google error or >15 s →
toast, nothing changes (manual Move still works). Move = set car + pinned; stops re-ordered by a
single-vehicle solve. (Release 1 has no solver: a moved rider is appended as the car's last stop.
Release 1 is never shipped alone, so no manual reordering UI is built.) A leader with no gender on
record covers neither gender: a car whose leaders' genders are all unknown shows amber
"leader gender unknown" and every rider placed there carries the gender penalty.

**Maps link.** `https://www.google.com/maps/dir/?api=1` with origin = church, destination = the
car's end (last stop when "Last drop"), `waypoints` + `waypoint_place_ids`, `travelmode=driving`;
split into ≤9-waypoint links.

**Route analysis (Release 3).** Detour per rider = t(prev→i) + t(i→next) − t(prev→next), using the
solved legs plus one `computeRouteMatrix` call for the skip legs. Highlight ≥ `detourMin` or ≥
`detourPct`% of the car's time. Try +N cars = re-solve with N virtual vehicles (seats chosen),
results only, nothing saved. Map = Google Static Maps (route polylines from the solve, numbered
markers from decoded polyline points), fetched server-side and streamed so the key stays secret.

## 8. API (`/bus/*` — add to router.ts, vercel.json routes regex, sw.js API_RE)

`GET /bus/run` (tonight's full state) · `GET /bus/run/version` · `GET /bus/search?q=` ·
`POST/PATCH/DELETE /bus/riders[/:id]` · `POST /bus/riders/:id/move` · `POST /bus/guests` ·
`GET /bus/guests/pending` · `POST /bus/guests/:id/link|dismiss` · `GET/POST/PATCH /bus/vehicles[/:id]` ·
`PATCH /bus/run/vehicles/:id` (tonight: running, leaders, Ends at) · `PATCH /bus/run/pool` ·
`POST /bus/run/own-car` · `PATCH /bus/leader-prefs/:leaderId` ·
`GET /bus/places/autocomplete?q=&session=` · `POST /bus/run/generate {mode:'all'|'fit'}` ·
`POST /bus/run/undo` · `GET /bus/runs` · `GET /bus/runs/:id` · `GET /bus/analysis` ·
`POST /bus/analysis/extra-cars {count,seats}` · `GET /bus/analysis/map`.
Module off → every route 404 via `ModuleDisabledError`.

## 9. Privacy and Google

- Google receives: autocomplete text (from our server, no name); place IDs + capacities + penalty
  numbers (no names/phones/grades); the leader's Maps link opens in their own Maps app.
- Encrypted at rest: addresses, place IDs, guest phones, own-car/vehicle end addresses, history
  snapshots. Rider mobiles shown only in My car, only for riders in your car.
- Env (server only): `GOOGLE_MAPS_API_KEY` (Places, Routes matrix, Static Maps — restricted to
  those APIs), `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_PROJECT_ID` (Route Optimization,
  OAuth). Billing account with budget alert; expected usage inside free tiers.
- `RoutingProvider` interface: `GoogleRoutingProvider` (prod) and `FakeRoutingProvider`
  (straight-line, deterministic) used in tests and `PERSISTENCE=memory`.

## 10. Testing

- `BusService` unit tests with in-memory repos + FakeRoutingProvider: capacity, pins, Fit in,
  gender/grade penalties mapped correctly, pool auto-fill, own cars, guest linking + purge,
  permissions matrix (incl. coordinator header), lock + expiry, Undo, version bumps, run rollover.
- Google request-builder tests (no network), incl. **no names/phones in any request body**.
- SPA: `extractFn` tests for Maps-link splitting and the version-poll diff; `scripts/check-spa-syntax.js`.
- Before merge: owner tests the complete feature locally (memory mode + a real Google key).
- Deploy: apply `0011` before aliasing; set Google env; `curl /bus/run` → 401 JSON; manual
  `vercel alias set`; enable via Youth Setup → Modules; keep `visibility:'admin'` until happy.

## 10a. Amendment (2026-10-05): parent consent + drop-off record

- **Parent consent** is per person (student or walk-in), not per night, and lasts until revoked.
  Table `bus_consents` (migration `0012`): student_id → students ON DELETE CASCADE | guest_id →
  bus_guests ON DELETE CASCADE (unique each), given bool, note enc (free text: when, who, call or
  text), recorded_by, recorded_at. Moves to the student when a walk-in is linked.
- Everyone added starts as **"Parent consent: not yet"** — an amber chip on Tonight, Routes and My
  car. **Warning only**: never blocks placing, moving or generating.
- Opening a rider on Tonight shows the consent box: tick "Parent consent given" + a required short
  note when ticked. Unticking revokes. Who: anyone with roster rights (`bus:roster` or coordinator).
- **Drop-off tick (optional)** on My car: each stop has "Dropped off"; ticking stores the current
  time + who, tapping the time edits it, unticking clears it. Columns `dropped_at`, `dropped_by` on
  `bus_run_riders`. Who: that car's leaders or anyone with `bus:coordinate`. Past nights show the times.

## 11. Out of scope

Pickups before youth, SMS "5 minutes away" automation, live driver GPS, bulk address import,
Supabase Realtime (polling instead — Data API stays disabled), drag-and-drop reordering.

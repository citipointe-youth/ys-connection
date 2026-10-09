# Bus Ministry — Past history, trends, editing, export (2026-10-09)

Owner decisions (2026-10-09): Past becomes a full page (like Routes/analysis) with trends + export;
director/admin can **edit** past nights and every edit is **logged**; **coordinators** can see Past
and export too (edits stay director/admin); the export carries **full addresses**; removing a rider
(Remove / "No lift needed") **keeps the row as "not riding"** instead of deleting it.

Review findings this fixes: who-drove is lost when a leader is deleted/Full Reset (names looked up
live); removed riders leave no trace; guest→student link erases "was a guest"; `/bus/runs` is 2
queries per night; Past hides unassigned riders and shows empty nights; no export/trends/edit.

## Migration `supabase/migrations/0014_bus_history.sql` (additive)
- `bus_run_vehicles.leader_snap jsonb not null default '[]'` — `[{id,name,gender}]` copied whenever a
  run car's `leader_ids` is saved. Backfill existing rows from `leaders` in the same file.
- `bus_run_riders`: `not_riding boolean not null default false`, `no_show boolean not null default false`,
  `note text` (nullable, **encrypted** in `supabase.bus.ts` like the other snap fields), `was_guest boolean not null default false`.
- `bus_run_edits (id uuid pk default gen_random_uuid(), run_id uuid not null references bus_runs(id) on delete cascade, at timestamptz not null default now(), by text not null, detail text not null)` — `detail` **encrypted**. Enable RLS like the other bus tables.

## Behaviour changes (backend)
- **Not riding:** `removeRider` and `saveMyCarStops` `removeIds` set `notRiding=true`, `runVehicleId=null`,
  `stopOrder=null`, `pinned=false` instead of deleting. **Exception kept:** an unlinked guest with no
  other run rows is still hard-deleted with their saved addresses (a mistaken entry). Every *tonight*
  read (run view riders, counts, my car, solver input, Generate/Fit in/Try +N cars/analysis,
  pastRiders' "on tonight" exclusion, seats checks, own-car rider ids, version) must ignore
  `notRiding` rows. Adding someone who has a `notRiding` row tonight **revives that row** (unique
  index on run_id+student_id / guest_id) with the new address instead of inserting.
- `linkOne` (guest→student) sets `wasGuest=true` on the rows it re-points.
- `leaderSnap` written on every save of a run vehicle's `leaderIds`. Past views use it, falling back to live names.
- `ctxOf` already rejects a `?now=` >36 h from the server clock (commit dcd4422).

## API
`GET /bus/history?from=YYYY-MM-DD` — gate `bus:coordinate` (coordinators via `as=`, quad/director/admin).
`from` defaults to 12 months before tonight. Nights strictly before tonight with ≥1 rider row, newest first.
Built from batch repo reads (`run_id = any(...)`), not per-night queries.
```ts
{ canEdit: boolean,                       // bus:analysis
  nights: [{ id, date, riders, placed, unassigned, dropped, notRiding, noShow, cars, seats,
             leaders: string[], guests, firstTime,          // firstTime = person's first ride ever
             edits?: [{ at, by, detail }] }],               // only when canEdit, newest first
  rides: [{ runId, date, riderId, studentId, guestId, kind: 'student'|'guest', wasGuest,
            name, grade, gender, car: string|null, carColour: number|null, runVehicleId,
            leaders: string[], stop: number|null, address, suburb,
            droppedAt, droppedBy, addedBy, notRiding, noShow, note }] }
```
`riders` = rows not notRiding; `placed` = those with a running car; `unassigned` = riders − placed.
`firstTime` uses ALL history (not just the window). `address` = the snapshot address (full, decrypted).

`PATCH /bus/runs/:id/riders/:riderId` — gate `bus:analysis`. Run must be strictly before tonight.
Body (all optional except reason may be ''): `{ runVehicleId?: string|null, droppedAt?: string|null (ISO), noShow?: boolean, notRiding?: boolean, note?: string|null (≤300), reason?: string (≤200) }`.
`runVehicleId` must be a car of that run (null = unassigned; moving clears stopOrder → append at end).
No routing, no lock. Writes one `bus_run_edits` row: `"<rider name>: car A → car B; dropped 9:41 pm → none; … (reason)"`,
`by` = `whoLabel(ctx)`. Bumps the run's last change. Returns `{ ok: true }`.
Existing `GET /bus/runs` and `/bus/runs/:id` stay (use leaderSnap names).

## SPA (Past page)
- Header **Past** button for `seesPast || v.canCoordinate`; opens `BUS.tab='past'` page (same pattern as
  `analysis`: highlighted header button, "‹ Back" link, `_busPickTab` accepts `'past'`).
- Top: `statCard` strip — Nights · Avg riders · People · New (first ride in last 4 weeks). Then a
  riders-per-night `colChart` (last 12 nights, neutral colour), tap a bar = open that night.
- `tbbar`: **Nights** / **People**. Export button (xlsx) in the page header row.
- Nights row: date · riders · cars, warn chips "N not logged" (placed, no droppedAt), "N unassigned".
- Night detail (modal): summary line; car cards (leaders chips, stops with suburb, dropped time or warn
  "not logged", no-show chip); Unassigned card; "Not riding" card; edit log list. If `canEdit`, tap a
  rider → edit sheet: car select (that night's cars + Unassigned), dropped-off time (`type=time`, blank =
  none, combined with the night's date), No-show toggle, Not riding toggle, Note, Reason → PATCH → reload.
- People: one row per person (studentId or guestId key): name, "rides/nights", last ride, chips
  Regular (≥50% of nights in window), New (first ride ≤28 days ago), Guest. Tap → that person's rides.
- Export `bus-history-YYYY-MM-DD.xlsx` using the `exportConnectCSV` pattern (`_ensureXlsx`, bold header):
  sheets **Nights** (Date, Riders, Cars, Dropped, Not logged, Unassigned, Not riding, No-show, Leaders),
  **Rides** (Date, Name, Grade, Student/Guest, Car, Leaders, Stop, Address, Dropped at, Dropped by, No-show, Not riding, Note),
  **People** (Name, Rides, First ride, Last ride, Regular).

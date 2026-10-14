-- Bus: "Fixed leaders" removed (operator 2026-10-14). Leaders on a car carry over from the
-- previous week's run (bus_run_vehicles.leader_ids), so the pinned-leader column is unused.
alter table bus_leader_prefs drop column if exists fixed_vehicle_id;

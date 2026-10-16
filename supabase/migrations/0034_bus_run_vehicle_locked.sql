-- Migration 0034: Bus Lock per car per night (2026-10-17, Plan I I11). Additive. A coordinator ticks Lock on a car;
-- Generate / Fit in / pool auto-fill / Unassign all / Undo then leave that car alone. Manual moves still work.
-- Each night gets fresh run-vehicle rows, so the lock resets weekly.
alter table bus_run_vehicles add column if not exists locked boolean not null default false;

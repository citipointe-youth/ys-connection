-- Migration 0038: Charter bus (BUS-2, 2026-10-18). Additive.
-- A vehicle can be a 'bus': a charter to its ends address (parents collect there). Copied per night like name/seats.
-- bus_addresses.vehicle_id marks a person's bus drop-off choice for that bus (remembered week to week).
alter table bus_vehicles add column if not exists kind text not null default 'car' check (kind in ('car', 'bus'));
alter table bus_run_vehicles add column if not exists kind text not null default 'car' check (kind in ('car', 'bus'));
alter table bus_addresses add column if not exists vehicle_id uuid references bus_vehicles(id) on delete cascade;

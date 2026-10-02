-- Login device tracking (owner request, 2026-10-02): which distinct phones/browsers have
-- logged in to each account, and when. Additive, default '[]' — no existing row is affected.
-- Each entry: {id, label, first, last, count}. Capped to the 10 most recently seen devices in the
-- application layer (auth.service.ts), not here. The id is a random per-browser value the SPA
-- generates and keeps in localStorage; it is not a hardware identifier.
alter table users add column if not exists login_devices jsonb not null default '[]'::jsonb;

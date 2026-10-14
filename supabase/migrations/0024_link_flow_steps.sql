-- Migration 0024: Elvanto link, the flows push's step list (UX batch 2026-10-14b T12; LINK_REV 5).
-- Additive. Null = the last flows push carried no steps (an older console): the app lists steps from the rows.
alter table link_mirror_state add column if not exists steps jsonb;

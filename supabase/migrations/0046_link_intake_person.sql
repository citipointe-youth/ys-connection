-- Migration 0046: consent hub (2026-10-23). Additive. The hub joins a family's intake row to the child's consent row and New People
-- step-0 row by Elvanto person id, and siblings by their shared parent form. Both come from the pushed row (no PII beyond an id).
alter table link_intake_rows add column if not exists person_id uuid; -- intake: the student profile once known; consent: = key
alter table link_intake_rows add column if not exists family uuid;    -- intake: the matched parent form's subId (siblings share it)

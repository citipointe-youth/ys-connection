-- October rework: per-leader Grades filter for the Junior/Senior (Simple) quad logins.
-- `view_grades` holds the grades a Junior/Senior login shows when this leader is picked
-- in "I am…"; null means "use the leader's own grades". Written only by the dedicated
-- PATCH /leaders/:id/view-grades path, so the general leader upsert never wipes it.
-- Additive; live code before this rework never names the column. No backfill.
alter table leaders add column if not exists view_grades int[];

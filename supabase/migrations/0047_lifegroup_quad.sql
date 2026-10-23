-- Migration 0047: lifegroup quad (2026-10-24). Additive. A lifegroup named for a leader quad with no "Grade N"
-- ("... Junior Girls Wednesday Lifegroup") keeps grade null and records its quad (g79/b79/g1012/b1012) here.
-- Set by the next lifegroup import; existing rows stay null until then.
alter table lifegroups add column if not exists quad text;

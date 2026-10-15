-- Migration 0030: S5 progress bars (run 2026-10-15b). Additive. The console's last progress post per job
-- ({ key: { done, total, stage, at } }, keys from link-contract PROGRESS_KEY; never a name). Entries over 10 min old are
-- dropped on the next write. The claim upsert does not touch it.
alter table link_console add column if not exists progress jsonb not null default '{}';

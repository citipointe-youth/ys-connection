-- Migration 0054: security review 2026-11-04 A13. The one-time safety copy from 0043 held per-student rows longer than needed; the audit now lives in
-- connection_audit_sources and nothing reads the copy. Not additive, by operator approval 2026-11-04: rolling back needs no restore, no code ever read it.
drop table if exists connection_audits_bak_0043;

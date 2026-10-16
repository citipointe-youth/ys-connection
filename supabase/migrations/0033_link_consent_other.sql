-- Migration 0033: Consents "Other" (2026-10-16, LINK_REV 8). Additive. One new consentLookup kind (other: step-0 students in no
-- pushed consent week, display only). Widens the kind CHECK constraint (same shape as 0031); nothing else changes.
alter table link_consent_lookup drop constraint if exists link_consent_lookup_kind_check;
alter table link_consent_lookup add constraint link_consent_lookup_kind_check check (kind in ('forms','mismatches','unlinked','other'));

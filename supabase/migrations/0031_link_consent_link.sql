-- Migration 0031: run 2026-10-15b lane L6. Additive. One new outbox type (consentLink: a console-local link of an unlinked consent
-- form to a person) and one new consentLookup kind (unlinked). Widens two CHECK constraints; nothing else changes.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink'));

alter table link_consent_lookup drop constraint if exists link_consent_lookup_kind_check;
alter table link_consent_lookup add constraint link_consent_lookup_kind_check check (kind in ('forms','mismatches','unlinked'));

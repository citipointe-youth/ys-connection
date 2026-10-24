-- Migration 0049: door search (LINK_REV 20, 2026-10-25, round/2026-10-25). Additive: widens the outbox type CHECK only.
-- doorSearch = a check-in leader's "Slow: Search Elvanto"
-- (a read; the typed name is the encrypted note). Applied by the same Vercel build that adds the type.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink','recheck','busConsentCheck','doorSearch'));

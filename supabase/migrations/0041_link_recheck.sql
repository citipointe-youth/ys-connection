-- Migration 0041: round 2026-10-21 lane L7 (LINK_REV 15). Additive. One new outbox type (recheck: the admin asks the console
-- to re-check whether an unclear save landed in Elvanto; read only). Widens the outbox type CHECK; nothing else changes.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink','recheck'));

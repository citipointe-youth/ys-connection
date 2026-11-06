-- Migration 0055: Reassign in Elvanto (LINK_REV 22, 2026-11-06, feat/elvanto-reassign). Additive: widens the outbox type CHECK only.
-- reassignStep = an admin/oversight Reassign of a flow row, sent to Elvanto by the console. Applied by the same Vercel build that adds the type.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink','recheck','busConsentCheck','doorSearch','reassignStep'));

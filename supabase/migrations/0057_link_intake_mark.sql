-- Migration 0057: Decline / Undo on the intake + consent plans (LINK_REV 24, 2026-11-14, fix/ys-needs-action-2-app). Additive.
-- intakeMark = an admin's decline (or undo) of one plan row, sent to Elvanto by the console. A pushed plan row may be flagged declined;
-- an unclear intake result may carry the family's name for the unclear card.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember','intakeAnswer','intakeSave','consentSave','intakeText',
  'removeFromFlowStep','consentLookup','consentFix','consentLink','recheck','busConsentCheck','doorSearch','reassignStep','intakeMark'));
alter table link_outbox add column if not exists result_name text;
alter table link_intake_rows add column if not exists declined boolean not null default false;

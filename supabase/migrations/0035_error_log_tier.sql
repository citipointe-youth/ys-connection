-- Migration 0035: Error log rework Part 1 (2026-10-17). Additive. Three tiers (now/later/fyi), a fold key so one cause
-- is one entry, and the 'reconcile' category for Part 2. Widens the 0019 category CHECK (same shape as 0031/0033).
-- Texts are computed at read time from the code; the stored tier is for "Clear FYI" and the console's entries filter.
alter table error_log drop constraint if exists error_log_category_check;
alter table error_log add constraint error_log_category_check
  check (category in ('server','link','elvanto-form','client','reconcile'));
alter table error_log add column if not exists tier text not null default 'later'
  check (tier in ('now','later','fyi'));
alter table error_log add column if not exists fold_key text;
create index if not exists error_log_fold_idx on error_log(fold_key, last_seen);
-- Backfill the existing rows (33 live) to the tiers textFor() gives them (src/services/error-log-text.ts).
update error_log set tier = 'fyi' where code in ('SERVICE_UNAVAILABLE','REQUEST_TIMEOUT','NETWORK','PUSH_FAILED',
  'NY_REQ_FAILED','CLIENT_ERROR') or code like 'HTTP_4%' or (category = 'client' and code not like 'JS_%')
  or (category = 'link' and code in ('report-exists','report-not-found','report-changed','member-left','not-in-group',
    'multi-service','unkept-notes','note-too-long','service-not-offered','did-not-meet-conflict','step-moved',
    'assignee-needed','ambiguous-first-timer','leader-member','plan-changed','saved-before','chain-not-done','bad-answer'))
  or (category = 'link' and code = 'too-old' and route = 'consentLookup');
update error_log set tier = 'now' where (category <> 'client' and code in ('LINK_OFF','ELVANTO_UNREACHABLE',
  'ELVANTO_FORM_CHANGED','STUDENT_FORM_UNCONFIRMED','PARENT_FORM_UNCONFIRMED','STUDENT_FORM_FAILED','PARENT_FORM_FAILED',
  'UNSENT_SAVE_FAILED','SETUP_INCOMPLETE','unclear','lease-lost','not-landed','pending-24h'))
  or (category = 'link' and route in ('consentSave','consentFix','consentLink') and tier = 'later');

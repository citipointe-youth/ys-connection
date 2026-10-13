-- Migration 0019: Elvanto link, lifegroup member changes (UX batch 2026-10-13 T6; contract X18).
-- Widens the link_outbox type check with addGroupMember / removeGroupMember. Nothing else changes.
alter table link_outbox drop constraint if exists link_outbox_type_check;
alter table link_outbox add constraint link_outbox_type_check check (type in ('checkIn','checkOut','submitReport','editReport',
  'completeStep','firstTimerCheckIn','addGroupMember','removeGroupMember'));

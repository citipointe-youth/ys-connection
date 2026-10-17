-- Migration 0037: Elvanto link REV 10 (consents run 2026-10-17, R8). Additive.
-- New People step 0: the parent-texted date (the Consents Other date) the consent Friday counts from; null = none found or an
-- older console (the Friday then counts from due).
alter table link_flow_people add column if not exists texted_on date;

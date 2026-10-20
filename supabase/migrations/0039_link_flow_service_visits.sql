-- Migration 0039: Elvanto link REV 13 (Service Visits, 2026-10-20). Additive.
-- A flows push row may carry serviceVisits: distinct service days this term since the student form (the form day counts);
-- null = unknown (an older console, no Elvanto id, or check-ins not readable yet).
alter table link_flow_people add column if not exists service_visits int;

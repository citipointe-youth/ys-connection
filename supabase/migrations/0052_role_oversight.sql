-- Migration 0052: rename the 'director' role to 'oversight' (data only, idempotent; a second run changes nothing).
-- Moves the role word in users and in the three label columns (nothing scopes on the labels), and the
-- roles.enabled.director config key to roles.enabled.oversight. The config update skips a legacy double-encoded
-- string value, a row with no roles.enabled object, a row that has no director key, and a row that already has oversight.
update users set role = 'oversight' where role = 'director';
update prayer_requests set created_by_role = 'oversight' where created_by_role = 'director';
update connections set assigned_by_role = 'oversight' where assigned_by_role = 'director';
update error_log set last_role = 'oversight' where last_role = 'director';
update app_settings set ministry_config = jsonb_set(ministry_config #- '{roles,enabled,director}', '{roles,enabled,oversight}', ministry_config->'roles'->'enabled'->'director')
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'roles') = 'object'
   and jsonb_typeof(ministry_config->'roles'->'enabled') = 'object'
   and ministry_config->'roles'->'enabled' ? 'director'
   and not (ministry_config->'roles'->'enabled' ? 'oversight');

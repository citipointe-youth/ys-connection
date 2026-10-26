-- Migration 0050: the module switchboard (modular setup Task 1.1, 2026-10-27). Additive and idempotent: it only adds
-- keys that are missing from app_settings.ministry_config.modules, so a second run changes nothing.
-- 1. The four new keys, each true (their code default, so the live install reads exactly as before).
-- 2. Pins checkin / lifegroupReport / flows where a row still inherits them from newYouthForms, so a later default
--    change cannot move a location. A JSON true/false newYouthForms (the legacy boolean) maps to 'on'/'off', because
--    only newYouthForms accepts the boolean: a raw copy would make the row fail to parse and read as all defaults.
--    A row with neither key is left alone (a fresh location), and a JSON null is never written.
-- Every statement skips a legacy double-encoded string value (left for the app to unwrap) and a row with no modules object.
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,liveLink}', 'true'::jsonb)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'liveLink');
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,digest}', 'true'::jsonb)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'digest');
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,camp}', 'true'::jsonb)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'camp');
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,busConsentForm}', 'true'::jsonb)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'busConsentForm');

update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,checkin}',
       case ministry_config->'modules'->'newYouthForms' when 'true'::jsonb then '"on"'::jsonb when 'false'::jsonb then '"off"'::jsonb
         else ministry_config->'modules'->'newYouthForms' end)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'checkin')
   and jsonb_typeof(ministry_config->'modules'->'newYouthForms') in ('string', 'boolean');
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,lifegroupReport}',
       case ministry_config->'modules'->'newYouthForms' when 'true'::jsonb then '"on"'::jsonb when 'false'::jsonb then '"off"'::jsonb
         else ministry_config->'modules'->'newYouthForms' end)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'lifegroupReport')
   and jsonb_typeof(ministry_config->'modules'->'newYouthForms') in ('string', 'boolean');
update app_settings set ministry_config = jsonb_set(ministry_config, '{modules,flows}',
       case ministry_config->'modules'->'newYouthForms' when 'true'::jsonb then '"on"'::jsonb when 'false'::jsonb then '"off"'::jsonb
         else ministry_config->'modules'->'newYouthForms' end)
 where id = 'global' and jsonb_typeof(ministry_config) = 'object' and jsonb_typeof(ministry_config->'modules') = 'object'
   and not (ministry_config->'modules' ? 'flows')
   and jsonb_typeof(ministry_config->'modules'->'newYouthForms') in ('string', 'boolean');

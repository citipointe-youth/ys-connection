-- Migration 0025: fixes 0022 (T4 2026-10-14b). 0022 matched the old username text (g79...), but prod logins were
-- quad79g/quad79b/quad1012g/quad1012b, so nothing changed. This keys on users.quad (the real scope column) instead.
-- Only email (the username) and display_name change; ids, password hashes, role and quad are untouched, and every
-- FK to users is by id. Idempotent: a row already on its target is skipped. Skipped too if the new username is
-- held by another user, or the quad has more than one account.
update users u set email = m.new_email, display_name = m.new_name, updated_at = now()
from (values ('g79','juniorgirls','Junior Girls'),('b79','juniorguys','Junior Guys'),
             ('g1012','seniorgirls','Senior Girls'),('b1012','seniorguys','Senior Guys')) as m(quad,new_email,new_name)
where u.role = 'quad' and u.quad = m.quad
  and (u.email is distinct from m.new_email or u.display_name is distinct from m.new_name)
  and not exists (select 1 from users x where lower(x.email) = m.new_email and x.id <> u.id)
  and (select count(*) from users y where y.role = 'quad' and y.quad = m.quad) = 1;

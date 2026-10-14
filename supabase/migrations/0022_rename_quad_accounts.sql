-- Migration 0022: UX batch 2026-10-14b T4. Quad logins g79/b79/g1012/b1012 become juniorgirls/juniorguys/seniorgirls/seniorguys.
-- Ids, password hashes and the role/quad scope columns are untouched (scope comes from users.quad, not the username).
-- Matches only a quad account still on its old username, so a hand-edited username is left alone and a re-run is a no-op.
update users u set email = m.new_email, display_name = m.new_name, updated_at = now()
from (values ('g79','juniorgirls','Junior Girls'),('b79','juniorguys','Junior Guys'),
             ('g1012','seniorgirls','Senior Girls'),('b1012','seniorguys','Senior Guys')) as m(old_email,new_email,new_name)
where u.role = 'quad' and lower(u.email) = m.old_email and u.quad = m.old_email
  and not exists (select 1 from users x where lower(x.email) = m.new_email);

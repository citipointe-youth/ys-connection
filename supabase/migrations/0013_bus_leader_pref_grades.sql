-- Bus Ministry: leaders in the pool (or fixed to a car) can have preferred grades, same
-- idea as a vehicle's prefGrades — the solver unions both onto the car they end up in.
alter table bus_leader_prefs add column if not exists pref_grades int[] not null default '{}';

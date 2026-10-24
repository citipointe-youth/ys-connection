-- Migration 0048: student graduated_at (2026-10-25, round/2026-10-25). Additive.
-- Elvanto's yearly grade update blanks a Year 12's grade; the roster push that sees that 12 -> blank change on a
-- matched Year 12 student stamps graduated_at. A graduated student is kept (history) but left out of student lists,
-- logins, pickers and charts; the admin can undo it (Student Search > Graduated). Null = not graduated.
alter table students add column if not exists graduated_at timestamptz;

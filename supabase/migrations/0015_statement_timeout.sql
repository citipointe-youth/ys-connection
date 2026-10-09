-- Role-level statement timeout (was a manual prod-only step; see CLAUDE.md
-- "Home-load performance investigation"). Must never fail a deploy.
do $$ begin
  alter role postgres set statement_timeout = '15s';
exception when others then raise notice 'statement_timeout skipped: %', sqlerrm;
end $$;

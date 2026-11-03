# Dev, seed accounts, testing recipe

## Commands and testing

```bash
npm install
npm run dev          # backend + frontend on http://localhost:4300 (tsx watch)
npm run start        # same, no watch
npm run typecheck    # tsc --noEmit (strict)
npm run test         # vitest; the count changes, see `npm test` output
```

Default port: **4300**. Set `PORT=xxxx` to override.

**Testing recipe.**
- `PERSISTENCE=memory` (the default) seeds demo data on startup; it is the only safe place for destructive or admin actions. Never test destructive admin actions against prod.
- Full local check (what `scripts/ship.sh` and CI run): `npm run typecheck`, `node scripts/check-spa-syntax.js`, `npm test`. The one-liner: `npx tsc --noEmit && npx vitest run && node scripts/check-spa-syntax.js`.
- `node scripts/check-spa-syntax.js` parses the inline script (run after every SPA edit). `src/tests/helpers/extract-fn.ts` (`extractFn`/`loadFns`) evaluates real function bodies from the HTML, so SPA logic can be unit-tested.
- **`src/tests/route-registration.test.ts`** fails when a router top-level segment is missing from `vercel.json` or `sw.js` `API_RE` (the 2026-07-18 `/prayers` misroute class).
- Bus routing is Fake when any Google env var is missing or `PERSISTENCE=memory`; set `BUS_ROUTING=google` to test a real key in memory mode.
- Never run `npm audit fix --force`. Plain `npm audit fix` is fine.

### Seed demo accounts (memory mode)

| Username | Role | Scope |
|-------|------|-------|
| `admin` | admin | All |
| `oversight` | oversight | All |
| `oversight2` | oversight | All (second oversight login) |
| `juniorgirls` | quad | Junior Girls (quad `g79`) |
| `juniorguys` | quad | Junior Guys (quad `b79`) |
| `seniorgirls` | quad | Senior Girls (quad `g1012`) |
| `seniorguys` | quad | Senior Guys (quad `b1012`) |
| `grade7` … `grade12` | grade | one per grade (the in-code seed has one account per grade) |

**This table describes `PERSISTENCE=memory` only.** `0003_seed_accounts.sql` is now an empty comment (2026-10-10): a new Supabase database has no accounts and the first `admin` is created on the setup screen with `SETUP_CODE` (see Modules → Setup and other locations).

Local `PERSISTENCE=memory` dev/demo mode: one random password for all of the above, printed once in the server log at start (F5 2026-10-22: no fixed seed password). Databases that ran the old `0003` seed have every seeded account flagged `must_change_password = true` (see "Forced password change" under Security notes). 2026-10-22 (F5): accounts still on that old seeded password show as a System check fix row ("Default passwords", names + usernames only) and so in Home > Needs attention; the check runs on the server (bcrypt compare of flagged accounts only, cached per hash); no forced change at sign-in (operator ruling).

**Username convention:** grade logins use **`g` (girls) / `b` (boys)** suffixes — e.g. `grade7g`, `grade7b` (NOT `…f` / `…m`, an earlier naming scheme). Usernames are **editable** in admin → Accounts → Edit (`account.service.update` accepts `email` with a uniqueness check — the field is internally still named `email`, it's just not treated as one anywhere in the app), so the actual logins can be renamed to this scheme.

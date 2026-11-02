# SPA house rules (read before editing public/)

`public/index.html` is the whole phone-first SPA (one inline script, ~16.7k lines). `install.html` / `save-password.html` are static help pages. After ANY edit here: `node scripts/check-spa-syntax.js`, and bump `public/sw.js` `CACHE` (`ysc-vN`, next free number) or `ship.sh` refuses. SPA logic is unit-tested via `src/tests/helpers/extract-fn.ts` (`extractFn`/`loadFns`). Architecture, UI standard, icons, service worker, admin tabs, More menu: `docs/areas/spa-ui.md`.

- **Apostrophes:** any contraction (can't/won't/doesn't/isn't/hasn't/...) inside a single-quoted JS string literal in `public/index.html` is a syntax error that blanks the whole SPA. Use double quotes; `check-spa-syntax.js` catches it.
- **const → function:** converting a module-scope `const` to a function in `public/index.html` is a call-site-wide change (`X[k]` on a function is a silent `undefined`): grep every bare `NAME[` and `NAME.` reference in the same commit. **`STG`/`STG_SHORT` → `STG()`/`STG_SHORT()`**, `EXPORT_GUIDES()` are functions.
- **jsonb:** **Fix: write jsonb via `sql.json(value)`, never `JSON.stringify(x)::jsonb`** (double-encodes; it once bricked `/settings`). `parseMinistryConfig` reads resiliently.
- **Escaping:** `esc()` every user-data interpolation (see Security notes). `encodeURIComponent` does not escape `'`, so `_smsHref()` manually replaces `'` → `%27` after encoding; pass ids, not names, through `onclick` strings.
- **Naming rule**: Login Activity helpers are all `_la*`. `_relTime` is the Prayers helper; the two once collided (later declaration wins) — never reuse that name.
- **A helper the link block calls must be global: nothing inside `const CA=(()=>{ … })()` is reachable from outside.** (`src/tests/link-globals.test.ts`.)
- **Labels:** grep for a bare `'Lifegroup'`/`'Grade'` string literal before adding new UI copy; the correct call is `L('smallGroup')`/`L('smallGroupPlural')`/`_gradeWord()`.
- **Client mirrors, keep in sync:** `MINISTRY_CONFIG_DEFAULTS_CLIENT` (ministry-config); `_isBirthdayInWeek()` is a frontend port of `followup.service.ts`'s `isBirthdayInWeek` — **keep them in sync**; the intake hold wording (`IK_HOLD`, `_ikHoldText`, `_ikNext`, ...) is a port of 11.1 `ix-logic.js`: **keep the two in sync**; `toAuMobile`/`tidyName` mirror `elvanto-forms.ts`.
- **CA `_lgCombine()`** rebuilds each lifegroup entry from a fixed field list: a new per-lifegroup field needs to be explicitly folded into that merge or it silently disappears when more than one term is selected.
- **Forms:** a bare `<button>` inside a form defaults to `type="submit"`; give Cancel-type buttons `type="button"`.
- **No dark mode:** **the app has no dark mode — never add `prefers-color-scheme:dark` rules**.
- **Bottom clearance:** keep `.pg`'s base (mobile) padding-bottom at `76px` = `calc(var(--nav-h) + var(--s3) + safe-b)` (it clears the fixed `.bot-nav`; desktop replaces it).
- **Nav labels:** two-line bottom-nav labels use the `.ni-lbl` pattern; keep new multi-word nav labels on this pattern.
- **Auth on boot:** `boot()` only clears the token on a 401 (a 503/network blip no longer logs people out); any 401 calls `_handleAuthExpired()`.
- **Late replies:** `_here()` before an await, then navigate / paint only if `_still(h)` (`_stillSheet(h)` before closing a sheet).
- **XSS:** `esc()` every user-data interpolation into `innerHTML`, including `e.message`/`err.message`. `src/tests/spa-xss-guard.test.ts` is a ship gate (reviewed exceptions go in its `ALLOW` map with a reason). Full notes: `docs/areas/security.md`.
- **Bulk cap:** every bulk path is capped at 50 (`Up to 50 at a time. Untick some first.`).
- **External links:** `_isStandalone()` + `_extOpen(ev,url)` (`x-safari-https:` is undocumented, with fallback `target=_blank`; `ext-links.spa.test.ts`).
- `API.post(p, b, t, quiet, keepalive)` (keepalive for small JSON bodies only).
- Never put docs under `public/`: Vercel serves it and ship.sh treats any `public/` change as an SPA change (SW bump).

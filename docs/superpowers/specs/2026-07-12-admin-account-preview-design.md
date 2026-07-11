# Admin account preview — design

## Problem

Admins configure grade/quad accounts (Admin → Accounts) but have no way to see what those
accounts actually see once logged in — the app's RBAC scoping (grade + gender) is enforced
server-side, so an admin's own session never renders a grade/quad-scoped view. Today the only
way to check is to actually log in as that account, which means knowing/resetting its password.

Inspiration: the Youth Camp Platform's "at-camp preview" (`../youth-camp-platform-masterv2`
CLAUDE.md, "At-camp preview" section) lets a user flip their own UI between pre-camp/at-camp
modes, client-side only, because it's the *same* logged-in user just viewing a different mode.
That doesn't transfer directly here — CMS's grade/gender scoping is enforced server-side from
the signed session token's embedded `Actor` (`src/services/auth.service.ts`,
`src/services/access-control.ts`), so there is no way to see what a grade/quad account sees
without the server actually treating the request as that account.

## Goal

From Admin → Accounts, the admin can click "Preview" on any **active grade or quad** account
and be dropped into a real, fully-functional session as that account — same nav, same screens,
same data scoping, and yes, real writes (connect/disconnect, edits) actually happen under that
account, exactly as if the admin had logged in with its password. A persistent banner shows
they're previewing, with an Exit button to return to their own admin session.

## Explicit non-goals (decided during brainstorming)

- **No write-blocking.** The app doesn't track "who made this change" today beyond what's
  already stored (e.g. `Leader.createdByGrade`); the admin explicitly wants real read+write
  parity with the account being previewed, not a read-only simulation.
- **No audit/logging of preview sessions.** Decided not worth the complexity for v1.
- **No confirmation modal before entering preview.** One click, no interstitial.
- **No new middleware, no new DB table, no migration.**
- **Director and leader accounts are out of scope** — only grade/quad accounts get a Preview
  button. Director is ministry-wide (closer to admin already); `leader` is a per-person junior
  login, not a shared cohort login.

## Approach: real impersonation token, reusing existing code

CMS already has `AuthService.issueTokenFor(userId)` (`src/services/auth.service.ts`) — it mints
a normal signed session token for any active user without needing a password. It's currently
only used internally, to refresh the caller's own token after a self-service password change.
This design exposes it (indirectly, via a new validated service method) to admins for an
arbitrary target account.

Two alternatives were considered and rejected:

- **Query-param scope override** (admin keeps their own token; a `?viewAs=` param swaps in a
  synthetic actor's scoping server-side per route). Rejected: touches every route, and writes
  would still be attributed to the admin's real token, not the previewed account — less
  faithful, for more code.
- **Pure client-side simulation** (mirroring the camp app's same-user preview: fake `S.user`,
  replicate grade/gender filtering in JS, keep the admin's own token). Rejected: CMS's RBAC
  surface is wide (students/leaders/connections/overview/trends/at-risk/lifegroup-stats) and
  CLAUDE.md already flags keeping scoping rules in sync across a few spots as a known risk —
  duplicating the *entire* surface in JS is a large liability, and it can't produce real writes
  under the target account at all (the server would still see the admin's token).

The real-token approach wins on both fidelity (100% real server-side RBAC, for free) and code
size (reuses existing token-minting; no new middleware or duplicate logic).

## Backend

**New method — `AccountService.previewAccount(actor: Actor, id: string): Promise<SafeUser>`**
(`src/services/account.service.ts`), following the existing pattern used by `toggleStatus`/
`remove`:

```
assertCan(actor, 'admin:manage');
const user = await users.findById(id);
if (!user) throw new NotFoundError('Account not found');
if (user.status !== 'active') throw new BadRequestError('Account is not active');
if (user.role !== 'grade' && user.role !== 'quad') {
  throw new BadRequestError('Only grade/quad accounts can be previewed');
}
return toSafe(user);
```

**Extend `AuthService.issueTokenFor`** (`src/services/auth.service.ts`) with an optional
override param, used only by preview:

```
issueTokenFor(userId: string, actorOverrides?: Partial<Actor>): Promise<string | null>
```

Implementation wraps the existing body: `signSession({ ...toActor(user), ...actorOverrides }, …)`.
All existing call sites are unaffected (no second argument passed). Preview calls it with
`{ mustChangePassword: false }` — without this override, previewing an account that's still
mid forced-password-change (a seeded account nobody has logged into yet) would drop the admin
straight into *that* account's forced-password-change screen, a dead end with no data to preview.

**New controller method** (`src/api/controllers/account.controller.ts`):

```
async preview(req: HttpRequest) {
  if (!req.ctx) throw new UnauthorizedError();
  const user = await deps.account.previewAccount(req.ctx, req.params['id']!);
  const token = await deps.auth.issueTokenFor(user.id, { mustChangePassword: false });
  return { token, user };
}
```

**New route** (`src/api/http/router.ts`):

```
{ method: 'POST', path: '/accounts/users/:id/preview', auth: true, handler: (r) => account.preview(r) },
```

`auth: true` requires any valid token to even reach the handler; `assertCan` inside
`previewAccount` does the actual `admin:manage` gate — same two-layer pattern every other
Accounts endpoint uses. No new error types, no schema/migration changes.

## Frontend (`public/index.html`)

**Accounts screen** (`renderAdminView`, `_adminTab === 'accounts'` row loop): add a fifth icon
button, shown only when `(u.role === 'grade' || u.role === 'quad') && u.status === 'active'`,
alongside the existing Edit/Reset Password/Lock/Delete buttons:

```
<button class="btn btn-ghost btn-sm" onclick="enterPreview('${u.id}')"
  title="Preview as ${esc(u.displayName)}" aria-label="Preview as ${esc(u.displayName)}">${icS('id')}</button>
```

Reuses an existing icon from the `IC` registry — no new SVG asset. `.li-right`'s icon gap is
tightened slightly (existing `gap` value reduced by a few px) since a row can now hold five
buttons.

**Preview state** — a module-level var, mirrored into `localStorage` under `yap_preview_stash`
so a mid-preview page refresh doesn't strand the admin with no way back except a fresh login:

```
let _previewStash = null; // { token, user } — the admin's own session, while previewing
```

On script boot, alongside the existing token-restore-from-`localStorage` logic: if
`yap_preview_stash` is present, parse it back into `_previewStash`.

**`enterPreview(id)`**:
1. `POST /accounts/users/${id}/preview` → `{ token, user }`.
2. `_previewStash = { token: API.token, user: S.user }`; persist it to `localStorage`.
3. `API.setToken(token); S.user = user;`
4. `Cache.clear()` — mandatory: prevents admin-scoped cached reads (e.g. `/students` fetched
   as admin) from leaking into the previewed session's renders.
5. `_shellReady = false; _initShell();` — rebuilds nav/header purely from `S.user`, so the
   previewed account's exact nav order, bottom-4 items, and role badge (e.g. "Grade 9 Girls")
   appear correctly with zero new nav logic.
6. `S.page = 'home'; render();`

**`exitPreview()`** (called from the banner's Exit button): symmetric reversal — restore
`API.setToken`/`S.user` from `_previewStash`, clear `_previewStash` from memory and
`localStorage`, `Cache.clear()`, rebuild shell, navigate home.

**Banner**: `_initShell()` conditionally renders a slim amber strip when `_previewStash` is
non-null — "Previewing: **{account displayName}**" plus an Exit button — positioned so it's
visible on every screen (the shell persists across navigations). New CSS only; not shared with
the camp app's `#previewBanner` (different repo, different markup).

## Edge cases

- **Admin tab unreachable while previewing** — already true with zero new code:
  `renderAdmin()` guards `if (S.user?.role !== 'admin') { go('home'); return; }`. A grade/quad
  preview session therefore can't reach Settings/Accounts, matching a real grade/quad login,
  and can't start a second preview without exiting the first.
- **Screens/actions the previewed role can't do** (Import, admin actions, etc.) are already
  correctly hidden/blocked — real RBAC on a real actor, not simulated.
- **Stashed admin token expiring** (12h TTL) during a long preview session — Exit would then
  restore an expired token; the next API call 401s and falls back to the existing login screen.
  Accepted as a known limitation, not specially handled.
- **Target account deactivated by someone else mid-preview** — out of scope for v1.

## Testing

- New `src/tests/account.service.test.ts` case(s) for `previewAccount`: rejects a non-admin
  actor; 404 for a missing id; rejects `director`/`leader`/`admin` roles; rejects
  `status: 'inactive'`; returns a `SafeUser` (no `passwordHash`) for a valid active grade/quad
  account.
- No new frontend test harness exists in this repo (SPA is verified manually) — this is
  consistent with existing frontend-only features.

## Explicitly out of scope for this feature

- Write-blocking / read-only mode.
- Audit logging of who previewed what.
- Confirmation modal before entering preview.
- Preview for director/leader/admin accounts.
- Any backend schema or migration change.

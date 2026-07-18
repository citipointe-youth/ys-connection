# Application-level encryption for student/parent phone numbers — design

**Date:** 2026-07-18
**Status:** Approved
**Repo:** `citipointe-youth/ys-connection` — production `PERSISTENCE=supabase`, ref `ltcblcudlzlzfcyzlhpc`

## Goal

`students.mobile` and `students.parent_phone` must be **encrypted at rest at the application
layer** so raw database access (including Supabase staff / SQL editor) reveals only ciphertext.
Plaintext exists only inside the running Node process after decryption, flowing to authorised
API responses/exports exactly as it does today. This ports the design and implementation already
built and deployed for the sibling Youth Camp Platform
(`../../../Project 9 - Camp Platform/youth-camp-platform-masterv2/docs/superpowers/specs/2026-07-16-field-encryption-design.md`),
scoped down to these two fields.

## Field scope (the query-safety proof)

Encryption breaks any DB-level `WHERE`/`ORDER BY`/`GROUP BY`/`JOIN`/`LIKE` on a column. Both
candidate fields were traced:

| Field (column) | Type | DB-level use | App-level use (post-decrypt) |
|---|---|---|---|
| `mobile` (`mobile`) | `text` | none | display, connect-export CSV, CSV import merge (read-only fallback) |
| `parentPhone` (`parent_phone`) | `text` | none | display, connect-export CSV, CSV import merge (read-only fallback) |

`SupabaseStudentRepository.search()` filters/sorts only on `first_name`/`last_name` (ILIKE +
in-JS fuzzy match). `import.service.ts` matches existing students by a **name key**
(`firstName+lastName`, lowercased) — `mobile`/`parentPhone` are only ever read from the
already-decrypted entity to merge in updated values, never used to look a row up. No other
table/service touches these columns. **Both fields are safe to encrypt.**

No other entity in this codebase (`Leader`, `User`, etc.) has a phone-like field — out of scope
by inspection, not by exclusion.

**Null-ness:** both fields are nullable `text | null`. Encrypt only non-null, non-empty values;
`null`/`''` always round-trip to `null` (never stored as ciphertext).

## Cryptographic design

Identical to the camp platform's implementation:

- **Algorithm:** AES-256-GCM via `node:crypto` (`createCipheriv`/`createDecipheriv`).
- **IV:** fresh 12-byte random IV per value (`randomBytes(12)`).
- **Auth tag:** 16-byte GCM tag (authenticated, tamper-evident).
- **AAD:** `"students:<column>:<id>"` (e.g. `"students:mobile:<studentId>"`) binds each
  ciphertext to its row/column so a copied value fails decryption elsewhere. Safe because
  student ids are app-generated and immutable.
- **Envelope:** `v1.<keyId>.<iv_b64url>.<tag_b64url>.<ct_b64url>`. The `v1.` prefix is the
  "already encrypted?" test — makes the backfill idempotent and lets reads tolerate a
  half-migrated table (decrypt if prefixed, else pass through as legacy plaintext).
- **Key(s):** a single 32-byte key, base64, in a Vercel env var. Ciphertext carries a `keyId` so
  a second key can coexist during a future rotation.

### New module: `src/utils/field-crypto.ts` (pure, DB-free, unit-tested)

Ported near-verbatim from the camp platform's module of the same name:

```
encryptField(plaintext: string, aad: string): string
decryptField(envelope: string, aad: string): string
isEncrypted(value: unknown): value is string
maybeEncrypt(value: string | null | undefined, aad: string): string | null
maybeDecrypt(value: string | null | undefined, aad: string): string | null
```

Keys loaded from `process.env` at call time (mirrors how this app's existing `crypto.ts` /
session-secret style code reads env directly). Missing key in production = hard error on first
encrypt/decrypt call; `memory`/`json` dev modes never invoke the codec, so no key is required
locally.

### Env vars

```
FIELD_ENCRYPTION_KEY=<base64 32 bytes>            # REQUIRED when PERSISTENCE=supabase
FIELD_ENCRYPTION_KEY_ID=k1                        # optional label; defaults to "k1"
FIELD_ENCRYPTION_KEY_PREV=<base64 32 bytes>       # optional, only during future rotation
FIELD_ENCRYPTION_KEY_PREV_ID=k0                   # optional, defaults to "k0"
```

Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
**A new key, distinct from the camp platform's** — separate Supabase project, separate blast
radius. The key must be backed up out-of-band; losing it makes the encrypted phone numbers
permanently unrecoverable (that is the security property, not a bug).

## Mapper integration (`src/repositories/supabase/supabase.students.ts`)

- **`toStudent()` (read):** `mobile`/`parentPhone` go through `maybeDecrypt(value, aad)` before
  being placed on the entity. A non-prefixed legacy plaintext value passes straight through
  (rollout tolerance).
- **`save()` / `saveMany()` (write):** for each field, compute `aad = "students:mobile:<id>"` /
  `"students:parent_phone:<id>"`, then `maybeEncrypt(value, aad)` before it goes into the SQL
  values/`on conflict do update` clause. No column shape change — both fields are encrypted
  **in place** (they're scalar `text`, unlike the camp app's array/jsonb fields that needed new
  `_enc` columns).
- **No schema migration required.** The column types don't change.
- Every other repository/service is untouched — they only ever see the decrypted `Student`
  entity via the interface.

## Rollout — idempotent, resumable, order-independent

1. **Ship tolerant code.** Deploy the codec + mapper changes with **read = decrypt-if-prefixed-
   else-passthrough, write = always-encrypt**. From this deploy on, any created/edited/imported
   student self-encrypts; the app tolerates a table that is any mix of plaintext and ciphertext.
2. **Backfill script** (`scripts/backfill-field-encryption.ts`, ported from the camp platform's
   script, run once against prod, re-runnable): `students.findAll()` then `saveMany()` in
   batches of 200 — the save path re-encrypts every row (already-ciphertext values decrypt then
   re-encrypt to the same plaintext, so this is idempotent). Order-independent (keyed by id).
   Resumable (re-running only re-touches rows, which is harmless — not wasteful enough to
   special-case skipping).
3. **Verify:** query prod and assert no non-null `mobile`/`parent_phone` value is missing its
   `v1.` prefix; spot-check a decrypt round-trip via the app (student search / detail screen).
4. **Purge plaintext from disk:** `VACUUM FULL students;` (brief exclusive lock; rewrites the
   table so the old plaintext row versions left behind by the backfill's `UPDATE`s are
   physically gone, rather than waiting on autovacuum). Run in a low-traffic window. This step is
   what makes the "unreadable to Supabase staff" guarantee true immediately.

Rollback before step 4 is trivial — nothing has been dropped, and reads already tolerate mixed
plaintext/ciphertext.

## Consequences / operational notes

- **Manual prod SQL** can no longer read or write `mobile`/`parent_phone` in the SQL editor —
  values are opaque ciphertext after backfill. Edits must go through the app.
- **Export/import unchanged:** the Connect Setup CSV export and CSV import merge logic consume
  `studentRepo.findAll()` (decrypted) — no code change needed there, verify explicitly after
  cutover.
- **Performance:** AES-GCM over ~a few hundred students × 2 fields is negligible (sub-millisecond
  per row). No added DB round-trips.
- **Rotation story (future, not needed now):** add `FIELD_ENCRYPTION_KEY_PREV`, re-run the
  backfill (re-encrypts under the new active `keyId`, tolerated by dual-key decrypt), retire the
  old key. Same script, no schema change.

## Testing

- `field-crypto.test.ts`: round-trip, null/empty passthrough, wrong-AAD rejection, tamper
  (flipped byte) rejection, `isEncrypted` prefix check, keyId selection.
- Supabase student-mapper round-trip unit test (row → `toStudent` → `save`'s column values)
  asserting ciphertext on the wire, plaintext on the entity, and null preservation.
- Regression: existing `student.service`, `import.service`, `connection.service` tests must stay
  green unchanged (they run in `memory` mode, proving services are oblivious to encryption).

## Out-of-scope / deferred

- Any field other than `students.mobile`/`students.parent_phone` (no other phone-like field
  exists in this codebase today).
- KMS/envelope encryption, per-record keys.
- Key rotation tooling beyond what the codec already supports (no rotation needed at initial
  rollout).

## Phased task list (for the implementer)

**Phase 0 — Codec (no DB, TDD).**
- Add `src/utils/field-crypto.ts` + `field-crypto.test.ts` (ported from the camp platform,
  adjusted only for this repo's lint/import conventions).
- Document `FIELD_ENCRYPTION_KEY[/_ID/_PREV/_PREV_ID]` in `src/config/env.ts` (read directly from
  `process.env` in the codec, same pattern as existing session/crypto code — no `env.ts` object
  change required, just a doc comment).

**Phase 1 — Mapper integration.**
- Update `supabase.students.ts`: `toStudent()` decrypts `mobile`/`parentPhone`; `save()`/
  `saveMany()` encrypt them. Mapper round-trip unit test. Full `npm run typecheck` + `npm run
  test` green.

**Phase 2 — Deploy tolerant code.**
- Push to `master` (auto-deploys). Generate + set `FIELD_ENCRYPTION_KEY` in Vercel prod env
  **before or with** this deploy (hard startup error otherwise in Supabase mode).

**Phase 3 — Backfill.**
- `scripts/backfill-field-encryption.ts` (batched, idempotent, resumable). Run against prod.
- Verify: no non-null `mobile`/`parent_phone` lacks the `v1.` prefix; spot-check decrypt via the
  app.

**Phase 4 — Purge.**
- `VACUUM FULL students;` in a low-traffic window.

**Phase 5 — Docs.**
- `CLAUDE.md` changelog entry noting the feature, the new env var, and that manual SQL edits to
  these two columns are no longer possible.

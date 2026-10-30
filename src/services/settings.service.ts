import { z } from 'zod';
import { assertCan } from './access-control';
import type { ISettingsRepository, IAuditRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { AppSettings } from '../core/entities/settings';
import type { Actor, User } from '../core/entities/user';
import { quadLabelFor, type UserRole } from '../core/types/enums';
import { generateId } from '../utils/id';
import { mergeMinistryConfig, mergeModulesUnresolved, MinistryConfigSchema, gradeRange, DEFAULT_LOCATION_QUESTION } from '../core/ministry-config';
import { moduleProblems, resolveModules } from '../core/module-tree';
import { invalidateOverviewCache } from './overview.service';
import { invalidateTrendsCache } from './trends.service';
import { invalidateLgStatsCache } from './lifegroup-stats.service';
import { AppError, BadRequestError } from '../core/errors/app-error';
import { googleRoutingEnabled } from './routing/google-routing-provider';
import { elvantoReady, checkForms, checkBusForm, formUrl, type FormCheck, type FormKind } from './elvanto-forms';

// The optional roles a ministry can switch off in Setup (Admin always exists
// and isn't toggleable — see ministry-config.ts). User.role values match these
// names exactly, so no extra mapping is needed to find the accounts a toggle covers.
const OPTIONAL_ROLES: Exclude<UserRole, 'admin'>[] = ['oversight', 'grade', 'quad', 'leader'];

const SettingsPatchSchema = z.object({
  termGapDays: z.number().int().min(1).optional(),
  validThresholdPct: z.number().min(0).max(100).optional(),
  serviceMinAttendance: z.number().int().min(0).optional(),
  // Validated structurally by mergeMinistryConfig (which re-runs the full
  // MinistryConfigSchema after merging) — accept any partial shape here so a
  // deep-partial patch like {branding:{accent:'#fff'}} isn't rejected up front.
  ministryConfig: z.record(z.unknown()).optional(),
  // T1: the value of each risky switch the client's draft was based on. A flip whose base no
  // longer matches the stored value is refused with 409, so a stale tab can't undo a change.
  expect: z.object({ simple: z.boolean().optional(), prayers: z.boolean().optional() }).optional(),
  // Modular setup: a save that turns Intakes off (itself, or through New person form / Live Elvanto link) runs onIntakeOff,
  // which deletes the waiting intake rows, so it needs this flag (the SPA sends it once the admin confirms).
  confirmIntakeOff: z.boolean().optional(),
});

const LOGIN_STYLE_MSG = 'Pick a Login style in Youth Setup: Junior/Senior, or Oversight and leaders.';
const CHANGED_MSG = 'Someone else changed this. Reload Youth Setup.';
export const INTAKE_OFF_MSG = 'Turning Intakes off deletes waiting intake rows.';

// P11: Check forms runs on the Youth Setup draft (not yet saved), validated by the same allow-list fields before any fetch.
const ELV = MinistryConfigSchema.shape.elvanto.removeDefault();
const ElvantoCheckSchema = ELV.pick({ baseUrl: true, studentFormId: true, parentFormId: true, busConsentFormId: true })
  .extend({ busConsentFormId: ELV.shape.busConsentFormId.removeDefault().optional(), location: ELV.shape.location.removeDefault().optional(), locationQuestion: z.string().max(120).optional() });
const FORM_GET_MS = 8_000; // as new-youth

/** `renamedQuads` is present only when the save flipped Simple (Junior/Senior) logins. */
export type SettingsUpdateResult = AppSettings & { renamedQuads?: number };

export interface SettingsService {
  get(): Promise<AppSettings>;
  update(actor: Actor, input: unknown): Promise<SettingsUpdateResult>;
  /** Check forms: reads both public forms of the draft links and maps every key by label. Returned, never saved. */
  elvantoCheck(actor: Actor, input: unknown): Promise<FormCheck>;
}

export function makeSettingsService(
  repo: ISettingsRepository,
  audit: IAuditRepository,
  users: IUserRepository,
  /** T4 (X19): called after a save that turns modules.intakeAdmin Off; deletes every link_intake_* row. */
  onIntakeOff?: () => Promise<void>,
): SettingsService {
  // Quad logins are picked by role + quad field (usernames can be edited). A hand-typed display
  // name is overwritten with its Junior/Senior name. Returns how many were actually renamed.
  async function renameQuads(): Promise<number> {
    let n = 0;
    for (const u of await users.findByRole('quad')) {
      if (!u.quad) continue;
      const name = quadLabelFor(u.quad);
      if (u.displayName === name) continue;
      await users.save({ ...u, displayName: name, updatedAt: new Date().toISOString() });
      n++;
    }
    return n;
  }

  return {
    async get() {
      return repo.getSettings();
    },

    async elvantoCheck(actor, input) {
      assertCan(actor, 'admin:manage');
      const d = ElvantoCheckSchema.safeParse(input);
      if (!d.success || !d.data.baseUrl || !d.data.studentFormId || !d.data.parentFormId) {
        throw new BadRequestError("Paste each form's public link in Youth Setup, Elvanto for this location.");
      }
      const cfg = (await repo.getSettings()).ministryConfig;
      const e = { ...cfg.elvanto, ...d.data, locationQuestion: d.data.locationQuestion?.trim() || cfg.elvanto.locationQuestion || DEFAULT_LOCATION_QUESTION };
      const get = async (kind: FormKind) => {
        try {
          const r = await fetch(formUrl(e, kind), {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YS-Connection)' }, redirect: 'manual', signal: AbortSignal.timeout(FORM_GET_MS),
          });
          if (r.status !== 200) throw new Error(`status ${r.status}`);
          return await r.text();
        } catch {
          throw new AppError('ELVANTO_UNREACHABLE', `Can't open the ${kind === 'busConsent' ? 'bus consent' : kind} form. Check the link.`, 502);
        }
      };
      // F11: the bus form is checked whenever a bus link is set (saved or sent), so Brisbane is covered on ship.
      const busForm = cfg.modules.busConsentForm ? e.busConsentFormId : ''; // Public consent form off: its form is not checked
      const [s, p, b] = await Promise.allSettled([get('student'), get('parent'), busForm ? get('busConsent') : Promise.resolve('')]);
      if (s.status === 'rejected') throw s.reason;
      if (p.status === 'rejected') throw p.reason;
      if (b.status === 'rejected') throw b.reason;
      const main = checkForms(s.value, p.value, e.location, gradeRange(cfg.structure), e.locationQuestion);
      if (!busForm) return main;
      const bus = checkBusForm(b.value, gradeRange(cfg.structure));
      return { ...main, ok: main.ok && bus.ok, n: main.n + bus.n, fields: { ...main.fields, ...bus.fields }, options: { ...main.options, ...bus.options },
        missing: [...main.missing, ...bus.missing], missingKeys: [...main.missingKeys, ...bus.missingKeys], lines: [...main.lines, ...bus.lines] };
    },

    async update(actor, input) {
      assertCan(actor, 'admin:manage');
      const patch = SettingsPatchSchema.parse(input);

      const ministryConfigPatch = patch.ministryConfig as Record<string, unknown> | undefined;
      if (ministryConfigPatch) {
        const branding = ministryConfigPatch['branding'] as Record<string, unknown> | undefined;
        // logoImage is a client-baked data URI (crop tool output) — no server-side
        // re-encoding, just a shape check. The Zod schema's .max() already caps size.
        // (Raw-SVG-paste branding was removed 2026-07-12 — see ministry-config.ts.)
        const logoImage = branding ? branding['logoImage'] : undefined;
        if (logoImage !== undefined && logoImage !== null && !(typeof logoImage === 'string' && logoImage.startsWith('data:image/'))) {
          throw new BadRequestError('branding.logoImage must be null or a data:image/... URI');
        }
        // I4: once the real Google provider is live, a "fake:" church place ID (only ever
        // produced by the dev/test fallback provider) must never be saved — every Generate
        // would then 400 against Google with no clue why.
        const busMinistry = ministryConfigPatch['busMinistry'] as Record<string, unknown> | undefined;
        const churchPlaceId = busMinistry ? busMinistry['churchPlaceId'] : undefined;
        if (typeof churchPlaceId === 'string' && churchPlaceId.startsWith('fake:') && googleRoutingEnabled()) {
          throw new BadRequestError('That address needs to be re-picked from the search results');
        }
        // Task 2 (owner): the church address is a "new address" path too — a non-blank
        // churchAddress saved without a real churchPlaceId means it was typed, not picked from
        // a suggestion. Only checked when this call actually touches churchAddress (an unrelated
        // busMinistry field patch, e.g. leaveTime, must not require re-saving the address).
        if (busMinistry && 'churchAddress' in busMinistry) {
          const addr = busMinistry['churchAddress'];
          const placeId = busMinistry['churchPlaceId'];
          if (typeof addr === 'string' && addr.trim() !== '' && (typeof placeId !== 'string' || placeId.trim() === '')) {
            throw new BadRequestError('Pick the address from the suggestions list');
          }
        }
      }

      const { ministryConfig: _omit, expect: base, confirmIntakeOff, ...scalarPatch } = patch;
      const update: Partial<AppSettings> = { ...scalarPatch };

      // Roles newly turned OFF by this save (compared against the pre-save config) —
      // computed before repo.updateSettings() so we still have both the old and new
      // enabled-map to diff. Deactivation itself runs after the settings write
      // succeeds (below), matching the confirm-then-cascade shape of a live setting.
      let rolesJustDisabled: UserRole[] = [];
      // Simple (Junior/Senior) logins. The reconcile runs on EVERY ministryConfig save, not only
      // on a flip, so a half-applied flip (a failed save mid-loop) is repaired by saving again.
      let simpleFlip = false;
      let simpleOnNow = false;
      let retire: User[] = [];
      let intakeOff = false;

      if (ministryConfigPatch !== undefined) {
        const current = await repo.getSettings();
        const cur = current.ministryConfig;
        if ((base?.simple !== undefined && base.simple !== cur.logins.simple)
          || (base?.prayers !== undefined && base.prayers !== cur.modules.prayers)) {
          throw new AppError('SETTINGS_CHANGED', CHANGED_MSG, 409);
        }
        // retiredGradeIds / gradeRoleWasOn are SERVER-OWNED: drop them from any client patch
        // (stale draft, second tab, settings file, raw PATCH) so the stored values carry forward.
        let cleanPatch: Record<string, unknown> = ministryConfigPatch;
        const loginsPatch = ministryConfigPatch['logins'];
        if (loginsPatch && typeof loginsPatch === 'object' && !Array.isArray(loginsPatch)) {
          const { retiredGradeIds: _r, gradeRoleWasOn: _w, ...rest } = loginsPatch as Record<string, unknown>;
          cleanPatch = { ...ministryConfigPatch, logins: rest };
        }
        // Bus consent check stamps are push-only (ingestBusConsentForms): a settings save keeps the stored values, so a
        // stale SPA echo never overwrites a newer console check.
        const busPatch = cleanPatch['busMinistry'];
        if (busPatch && typeof busPatch === 'object' && !Array.isArray(busPatch)) {
          const { consentLastChecked: _c, consentLastNew: _n, ...rest } = busPatch as Record<string, unknown>;
          cleanPatch = { ...cleanPatch, busMinistry: rest };
        }
        const merged = mergeMinistryConfig(cur, cleanPatch);
        // Module tree rules (module-tree.ts): refuse a save that leaves a module on without what it needs, rather than let
        // the resolver hide it silently. The one cascade allowed is Intakes following its parents off, behind the confirm.
        const asked = mergeModulesUnresolved(cur, cleanPatch);
        const intakeDrop = cur.modules.intakeAdmin === 'on' && resolveModules(asked).intakeAdmin === 'off';
        if (intakeDrop) asked.intakeAdmin = 'off';
        const problems = moduleProblems(asked);
        if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join(' '), 400, { problems });
        if (intakeDrop && confirmIntakeOff !== true) throw new AppError('INTAKE_OFF_CONFIRM', INTAKE_OFF_MSG, 400);
        // Only turning New person on is refused: a save that leaves the mode alone (e.g. an incomplete block after a
        // rollback) must not block unrelated Youth Setup saves; the send-time 409 ELVANTO_NOT_SET is the guard there.
        if (cur.modules.newYouthForms === 'off' && merged.modules.newYouthForms !== 'off' && !elvantoReady(merged)) {
          throw new BadRequestError('Fill in Elvanto for this location. Then select Check forms.');
        }
        const wasOn = cur.logins.simple;
        const isOn = merged.logins.simple;
        simpleOnNow = isOn;
        simpleFlip = wasOn !== isOn;
        if (isOn) {
          // The rule (Login style, 2026-10-27): with no grade logins, the ministry is either Junior/Senior (the
          // grades-quads cohort model and the Quad role) or Oversight and leaders (cohort model none, no Quad role).
          // A half-and-half state is refused. Grade 6 is junior since T13, so Include Grade 6 is fine.
          if ((merged.structure.cohortModel === 'grades-quads') !== merged.roles.enabled.quad) throw new BadRequestError(LOGIN_STYLE_MSG);
          merged.roles.enabled.grade = false;
          // Every active grade login is retired and listed (normally none while on).
          retire = (await users.findByRole('grade')).filter((u) => u.status === 'active');
          const listed = wasOn ? cur.logins.retiredGradeIds : [];
          merged.logins.retiredGradeIds = [...new Set([...listed, ...retire.map((u) => u.id)])];
          if (!wasOn) merged.logins.gradeRoleWasOn = cur.roles.enabled.grade;
        } else if (wasOn) {
          merged.roles.enabled.grade = cur.logins.gradeRoleWasOn;
          // Restore BEFORE the write that clears the list: a failure here leaves the stored
          // config (Simple on, full list) untouched, and saving OFF again finishes the job.
          // Only ids that still exist, are still grade logins and are still inactive come back.
          for (const id of cur.logins.retiredGradeIds) {
            const u = await users.findById(id);
            if (u && u.role === 'grade' && u.status === 'inactive') {
              await users.save({ ...u, status: 'active', updatedAt: new Date().toISOString() });
            }
          }
          merged.logins.retiredGradeIds = [];
        }
        update.ministryConfig = merged;
        intakeOff = merged.modules.intakeAdmin === 'off' && cur.modules.intakeAdmin === 'on';

        const before = cur.roles?.enabled;
        const after = merged.roles.enabled;
        // While Simple is on, the retire list above is the only path for grade logins.
        rolesJustDisabled = OPTIONAL_ROLES.filter((r) => before?.[r] !== false && after[r] === false && !(isOn && r === 'grade'));
      }

      if (Object.keys(patch).length > 0) {
        await audit.save({
          id: generateId(),
          action: 'settings-update',
          performedBy: actor.displayName,
          performedAt: new Date().toISOString(),
          detail: `Settings updated: ${Object.keys(patch).join(', ')}`,
        });
      }

      const updated = await repo.updateSettings({ ...update, updatedAt: new Date().toISOString() });

      // Fix for the pre-existing invalidation gap: any settings change (term
      // math, min-attendance floor, or ministryConfig) could affect the three
      // 60s actor-keyed stats caches. Cleared straight after the write, so a
      // later failure (retire loop, rename) cannot leave them stale.
      invalidateOverviewCache();
      invalidateTrendsCache();
      invalidateLgStatsCache();

      for (const u of retire) await users.save({ ...u, status: 'inactive', updatedAt: new Date().toISOString() });
      if (intakeOff) await onIntakeOff?.();

      // A role toggled OFF in Setup deactivates every currently-active account of
      // that role — the Accounts screen also hides that role's whole section
      // while disabled (index.html), so a leftover active account there would be
      // both unreachable to manage AND still able to log in. Turning the role
      // back ON later does NOT auto-reactivate these — deliberate: an admin who'd
      // separately deactivated one of these accounts for an unrelated reason
      // shouldn't have that overridden by an unrelated toggle. Re-activation is
      // manual, via the existing per-account lock/unlock in Accounts.
      for (const role of rolesJustDisabled) {
        const accounts = await users.findByRole(role);
        for (const u of accounts) {
          if (u.status !== 'active') continue;
          await users.save({ ...u, status: 'inactive', updatedAt: new Date().toISOString() });
        }
      }

      // Quad names follow Simple logins on every save while on (repairs a failed rename), and
      // on the off flip. The count is returned when something was renamed or the switch flipped.
      if (simpleOnNow || simpleFlip) {
        const n = await renameQuads();
        if (n > 0 || simpleFlip) return { ...updated, renamedQuads: n };
      }
      return updated;
    },
  };
}

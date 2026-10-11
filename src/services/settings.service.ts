import { z } from 'zod';
import { assertCan } from './access-control';
import type { ISettingsRepository, IAuditRepository, IUserRepository } from '../repositories/interfaces/entity-repositories';
import type { AppSettings } from '../core/entities/settings';
import type { Actor } from '../core/entities/user';
import { QUAD_LABELS, quadLabelFor, type UserRole } from '../core/types/enums';
import { generateId } from '../utils/id';
import { mergeMinistryConfig } from '../core/ministry-config';
import { invalidateOverviewCache } from './overview.service';
import { invalidateTrendsCache } from './trends.service';
import { invalidateLgStatsCache } from './lifegroup-stats.service';
import { BadRequestError } from '../core/errors/app-error';
import { googleRoutingEnabled } from './routing/google-routing-provider';

// The optional roles a ministry can switch off in Setup (Admin always exists
// and isn't toggleable — see ministry-config.ts). User.role values match these
// names exactly, so no extra mapping is needed to find the accounts a toggle covers.
const OPTIONAL_ROLES: Exclude<UserRole, 'admin'>[] = ['director', 'grade', 'quad', 'leader'];

const SettingsPatchSchema = z.object({
  termGapDays: z.number().int().min(1).optional(),
  validThresholdPct: z.number().min(0).max(100).optional(),
  serviceMinAttendance: z.number().int().min(0).optional(),
  // Validated structurally by mergeMinistryConfig (which re-runs the full
  // MinistryConfigSchema after merging) — accept any partial shape here so a
  // deep-partial patch like {branding:{accent:'#fff'}} isn't rejected up front.
  ministryConfig: z.record(z.unknown()).optional(),
});

const SIMPLE_ON_MSG = 'Turn off Junior/Senior logins first';

/** `renamedQuads` is present only when the save flipped Simple (Junior/Senior) logins. */
export type SettingsUpdateResult = AppSettings & { renamedQuads?: number };

export interface SettingsService {
  get(): Promise<AppSettings>;
  update(actor: Actor, input: unknown): Promise<SettingsUpdateResult>;
}

export function makeSettingsService(
  repo: ISettingsRepository,
  audit: IAuditRepository,
  users: IUserRepository,
): SettingsService {
  // Quad logins are picked by role + quad field (usernames can be edited). A hand-typed display
  // name is overwritten in both directions. Returns how many were actually renamed.
  async function renameQuads(simple: boolean): Promise<number> {
    let n = 0;
    for (const u of await users.findByRole('quad')) {
      if (!u.quad) continue;
      const name = simple ? quadLabelFor(u.quad, true) : QUAD_LABELS[u.quad];
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

      const { ministryConfig: _omit, ...scalarPatch } = patch;
      const update: Partial<AppSettings> = { ...scalarPatch };

      // Roles newly turned OFF by this save (compared against the pre-save config) —
      // computed before repo.updateSettings() so we still have both the old and new
      // enabled-map to diff. Deactivation itself runs after the settings write
      // succeeds (below), matching the confirm-then-cascade shape of a live setting.
      let rolesJustDisabled: UserRole[] = [];
      // Simple (Junior/Senior) logins transition, applied after the settings write.
      let simpleFlip: 'on' | 'off' | null = null;
      let retireIds: string[] = [];
      let restoreIds: string[] = [];

      if (ministryConfigPatch !== undefined) {
        const current = await repo.getSettings();
        // retiredGradeIds / gradeRoleWasOn are SERVER-OWNED: drop them from any client patch
        // (stale draft, second tab, settings file, raw PATCH) so the stored values carry forward.
        let cleanPatch: Record<string, unknown> = ministryConfigPatch;
        const loginsPatch = ministryConfigPatch['logins'];
        if (loginsPatch && typeof loginsPatch === 'object' && !Array.isArray(loginsPatch)) {
          const { retiredGradeIds: _r, gradeRoleWasOn: _w, ...rest } = loginsPatch as Record<string, unknown>;
          cleanPatch = { ...ministryConfigPatch, logins: rest };
        }
        const merged = mergeMinistryConfig(current.ministryConfig, cleanPatch);
        const wasOn = current.ministryConfig.logins.simple;
        const isOn = merged.logins.simple;
        if (isOn) {
          // The rule: Simple logins needs the Complex cohort model and the Quad role.
          if (merged.structure.cohortModel !== 'grades-quads' || !merged.roles.enabled.quad) {
            throw new BadRequestError(SIMPLE_ON_MSG);
          }
          merged.roles.enabled.grade = false;
        }
        if (!wasOn && isOn) {
          // Collect the active grade logins BEFORE the write (also catches ones left active
          // while the Grade role was already off), and record them in that same write.
          retireIds = (await users.findByRole('grade')).filter((u) => u.status === 'active').map((u) => u.id);
          merged.logins.retiredGradeIds = retireIds;
          merged.logins.gradeRoleWasOn = current.ministryConfig.roles.enabled.grade;
          simpleFlip = 'on';
        } else if (wasOn && !isOn) {
          merged.roles.enabled.grade = current.ministryConfig.logins.gradeRoleWasOn;
          restoreIds = current.ministryConfig.logins.retiredGradeIds;
          merged.logins.retiredGradeIds = [];
          simpleFlip = 'off';
        }
        update.ministryConfig = merged;

        const before = current.ministryConfig.roles?.enabled;
        const after = merged.roles.enabled;
        rolesJustDisabled = OPTIONAL_ROLES.filter((r) => before?.[r] !== false && after[r] === false);
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

      // Simple logins on: retire exactly the ids recorded above. Off: bring back only listed
      // ids that still exist, are still grade logins and are still inactive.
      for (const id of retireIds) {
        const u = await users.findById(id);
        if (u && u.status === 'active') await users.save({ ...u, status: 'inactive', updatedAt: new Date().toISOString() });
      }
      for (const id of restoreIds) {
        const u = await users.findById(id);
        if (u && u.role === 'grade' && u.status === 'inactive') {
          await users.save({ ...u, status: 'active', updatedAt: new Date().toISOString() });
        }
      }

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

      // Fix for the pre-existing invalidation gap: any settings change (term
      // math, min-attendance floor, or ministryConfig) could affect the three
      // 60s actor-keyed stats caches, which previously had no invalidation
      // hook on this path at all — see design doc / CLAUDE.md's "Settings
      // updates invalidate NO caches" gotcha.
      invalidateOverviewCache();
      invalidateTrendsCache();
      invalidateLgStatsCache();

      if (simpleFlip) return { ...updated, renamedQuads: await renameQuads(simpleFlip === 'on') };
      return updated;
    },
  };
}

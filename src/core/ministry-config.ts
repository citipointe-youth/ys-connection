import { z } from 'zod';
import { BadRequestError } from './errors/app-error';
import { resolveModules } from './module-tree';

// Per-deployment configuration: branding, terminology, structure, roles, modules,
// and import dialect. An empty/absent value at any level always means "YS
// Brisbane behaviour" — every default below is the current, unconfigured
// behaviour of the app, verbatim. See CLAUDE.md / the generalisation design doc
// for the full rationale; this file is the single source of truth for defaults
// (repos and the SPA's mirror both read MINISTRY_CONFIG_DEFAULTS, never redeclare
// them).

const TZ_MSG = 'Time zone not recognised.';
const CUTOFF_MSG = '"Consent closes at" in Youth Setup must be a 24-hour time, such as 09:00.';
const isTimeZone = (tz: string) => { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz !== ''; } catch { return false; } };

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour (e.g. #1a1af2)');

// 'two-bracket' was dropped 2026-07-10: a medium ministry wanting bracket-sized
// cohorts now just creates broader grade-equivalent accounts (1+ grades each)
// under 'large-graded-au' and skips creating quad accounts — an account-creation
// choice, not a ministryConfig difference. See CLAUDE.md / design doc §5.1a.
// 'small-flat' and 'micro' were merged into a single 'simple' preset 2026-07-11 —
// having 3 presets with a subtle micro-vs-small-flat distinction (lifegroups/
// export guides only) wasn't earning its complexity; a ministry that wants those
// off individually can still flip them in the (now un-layered) fine-tuning cards.
// 2026-10-27: 'simple' has no config any more (see PRESET_CONFIGS) and stays here only so stored rows parse.
export const MINISTRY_PRESETS = ['large-graded-au', 'simple'] as const;
export type MinistryPreset = (typeof MINISTRY_PRESETS)[number];

export type NewYouthMode = 'off' | 'admin' | 'on';

// D9 (2026-10-19): the admin-only state was called 'shadow'. Stored configs, settings files and cached
// phones still send it, so 'shadow' is read as 'admin' forever.
const MODE = z.enum(['off', 'admin', 'on']);
const unShadow = (v: unknown) => (v === 'shadow' ? 'admin' : v);
const moduleMode = z.preprocess(unShadow, MODE);
const uuidOrEmpty = z.union([z.literal(''), z.string().uuid()]);

export const DEFAULT_LOCATION_QUESTION = 'Citipointe Location';

// Drafted from the form's consent text (spec §5.5 step 4). G1: the operator or Citipointe approves it before go-live.
export const DEFAULT_CONSENT_DECLARATION = 'Do you give permission for [child] to travel on the Youth Society bus to, from and during Friday nights at Citipointe Brisbane? Do you consent to the leaders arranging emergency medical, hospital or ambulance care if needed, at your cost? Do you release Citipointe from liability as set out in the full form? Do you agree to us contacting you with updates? The full terms and privacy policy are at citipointechurch.com.';

const ModulesSchema = z.object({
  connectionAudit: z.boolean().default(true),
  lifegroups: z.boolean().default(true),
  exportGuides: z.enum(['elvanto', 'hidden']).default('elvanto'),
  busMinistry: z.boolean().default(false),
  // New person (internal name: new youth forms): the screen submits Citipointe's two public Elvanto connect forms.
  // 'off' = nobody, 'admin' = the admin login only, 'on' = every role. Off by default.
  // The old boolean is still read (true = on, false = off) so a config stored before this change parses.
  newYouthForms: z.preprocess((v) => (v === true ? 'on' : v === false ? 'off' : unShadow(v)), MODE).default('off'),
  // Prayers module (October rework). On by default; when off every prayer route answers 404 and the data is kept.
  prayers: z.boolean().default(true),
  // Notices (2026-10-15): admin/director messages to the four quad logins. Off by default; off = every /notices route answers 404.
  notices: z.enum(['off', 'on']).default('off'),
  // T10 (2026-10-12): the Elvanto link screens, each off / admin (admin only) / on. Missing = the newYouthForms
  // value, so a config stored before the split keeps behaving exactly as it did.
  checkin: moduleMode.optional(),
  lifegroupReport: moduleMode.optional(),
  flows: moduleMode.optional(),
  // T4 (2026-10-13, ruling R3): youth intake + consents through the Elvanto link. A plain Off / On switch, admin only.
  intakeAdmin: z.enum(['off', 'on']).default('off'),
  // 2026-10-14: per flow (Elvanto flow id), the step no login lists, completes or assigns on Flow steps.
  // Flow Steps screen, non-admin logins only (T11). Missing or '' = the first step (stepOrder <= 1), 'none' = no hidden step, else that step's id.
  flowHiddenStep: z.record(z.string().max(64), z.string().max(64)).default({}),
  // Modular setup (2026-10-27): the switchboard keys. Defaults keep today's behaviour (nothing hidden); the setup wizard
  // writes explicit values for a new location. module-tree.ts holds the tree and its rules.
  liveLink: z.boolean().default(true),
  digest: z.boolean().default(true),
  camp: z.boolean().default(true),
  busConsentForm: z.boolean().default(true),
});
/** modules as stored or patched, before resolveModules. */
export type ModulesIn = z.infer<typeof ModulesSchema>;
/** modules after resolveModules: the three link screens always carry a value. */
export type Modules = Omit<ModulesIn, 'checkin' | 'lifegroupReport' | 'flows'> & { checkin: NewYouthMode; lifegroupReport: NewYouthMode; flows: NewYouthMode };

export const MinistryConfigSchema = z.object({
  version: z.literal(1).default(1),
  preset: z.enum(MINISTRY_PRESETS).default('large-graded-au'),

  branding: z
    .object({
      ministryName: z.string().max(60).default('Youth Society Brisbane'),
      appName: z.string().max(40).default('YS Connection'),
      shortName: z.string().max(15).default('Connection'),
      accent: hexColour.default('#1a1af2'),
      accentDark: hexColour.default('#1111c9'),
      accentLight: hexColour.default('#ececff'),
      navy: hexColour.default('#0a0a2e'),
      // A cropped-to-square data URI (image/png or image/jpeg) baked client-side
      // by the Youth Setup crop tool. 500_000 chars (~375KB decoded) comfortably
      // fits a 512x512 JPEG at quality 0.85. Raw-SVG-paste branding was removed
      // (2026-07-12) — a hand-rolled tag/attribute denylist (sanitiseLogoSvg,
      // since deleted) couldn't safely neutralise admin-supplied markup rendered
      // via innerHTML on the public, pre-auth login screen (e.g. an unquoted
      // `onload=` attribute survived the denylist entirely). Raster upload only.
      logoImage: z.string().max(500_000).nullable().default(null),
    })
    .default({}),

  labels: z
    .object({
      smallGroup: z.string().max(40).default('Lifegroup'),
      smallGroupPlural: z.string().max(40).default('Lifegroups'),
      service: z.string().max(40).default('Youth'),
      serviceNight: z.string().max(40).default('Friday Nights'),
      studentTeam: z.string().max(40).default('Student Team'),
      connection: z.string().max(40).default('Connection'),
      groupNameStrip: z.array(z.string()).default(['Brisbane - YS - ']),
      busMinistry: z.string().max(40).default('Bus Ministry'),
    })
    .default({}),

  structure: z
    .object({
      // Only two values (design §5.1a) — grade-equivalent accounts (one or
      // more grades each) are always the base under 'grades-quads'; whether
      // any quad-equivalent rollup accounts exist is an independent,
      // per-account-creation choice, not a cohortModel value.
      cohortModel: z.enum(['grades-quads', 'none']).default('grades-quads'),
      gradeMin: z.number().int().default(7),
      gradeMax: z.number().int().default(12),
      gradeLabel: z.string().max(20).default('Grade'),
      genderPolicy: z.enum(['strict', 'soft', 'off']).default('strict'),
      serviceDayOfWeek: z.number().int().min(0).max(6).default(5),
      timeZone: z.string().max(60).refine(isTimeZone, TZ_MSG).default('Australia/Brisbane'),
      consentCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, CUTOFF_MSG).default('09:00'), // 00:00-23:59 (a strict subset of the claim's ^\d{2}:\d{2}$)
    })
    .default({}),

  // Role names are fixed (Admin, Director, Grade, Quad, Leader) — not
  // per-deployment relabelable. `enabled` picks which OPTIONAL roles this
  // ministry uses; Admin always exists and isn't toggleable.
  roles: z
    .object({
      enabled: z
        .object({
          director: z.boolean().default(true),
          grade: z.boolean().default(true),
          quad: z.boolean().default(true),
          leader: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),

  // resolveModules (module-tree.ts) fills the link screens from newYouthForms and turns off what a parent turned off.
  modules: ModulesSchema.transform((m): Modules => resolveModules(m)).default({}),

  // Simple logins (October rework, spec A): Junior/Senior quad logins replace the grade logins.
  logins: z
    .object({
      simple: z.boolean().default(false),
      // SERVER-OWNED. Never taken from a client patch (see "Server-owned fields").
      retiredGradeIds: z.array(z.string()).default([]),
      gradeRoleWasOn: z.boolean().default(true),
    })
    .default({}),

  import: z
    .object({
      dateOrder: z.enum(['DMY', 'MDY']).default('DMY'),
      leaderTag: z.string().max(20).default('leader'),
    })
    .default({}),

  // Bus Ministry module settings (spec 2026-10-05). Edited from the Bus
  // settings sheet (admin) via PATCH /settings. No ministry-specific defaults.
  busMinistry: z
    .object({
      churchAddress: z.string().max(200).default(''),
      churchPlaceId: z.string().max(300).default(''),
      leaveTime: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
      targetRouteMin: z.number().int().min(10).max(240).default(45),
      prefWeightMin: z.number().int().min(0).max(120).default(10),
      genderWeightMin: z.number().int().min(0).max(600).default(120),
      detourMin: z.number().int().min(1).max(120).default(10),
      detourPct: z.number().int().min(1).max(100).default(20),
      coordinatorLeaderIds: z.array(z.string()).default([]),
      // Bus consent via the Elvanto form (spec 2026-10-22): the abbreviated declaration a leader reads out (Bus settings, admin),
      // and the last console check (written by the push, never by a phone).
      consentDeclaration: z.string().max(2000).default(DEFAULT_CONSENT_DECLARATION),
      consentLastChecked: z.string().max(40).default(''),
      consentLastNew: z.number().int().min(0).default(0),
    })
    .default({}),

  // This location's Elvanto forms and flows (multisite SPEC §2.2). Write targets, so every default is blank
  // and a blank one refuses (never falls back to Brisbane). Brisbane's values arrive via migration 0040.
  elvanto: z
    .object({
      // The server fetches this (Check forms, New person), so it is an allow-list, not free text (no SSRF).
      // "https://<org>.elvanto.com.au", no trailing slash.
      baseUrl: z.union([z.literal(''), z.string().regex(/^https:\/\/[a-z0-9-]+\.elvanto\.(com\.au|com|net|eu)$/)]).default(''),
      studentFormId: uuidOrEmpty.default(''),
      parentFormId: uuidOrEmpty.default(''),
      location: z.string().max(60).default(''), // Location option LABEL on both forms, e.g. "Brisbane"
      // 2026-10-22 F7: the location QUESTION label Check forms looks for. A read label, not a write target, so it
      // defaults to the shared Citipointe tenant's wording (Brisbane relies on it); a wrong one only reads "Not found".
      // Blank (saved or stored) reads as the default, so Check forms never searches for an empty label.
      locationQuestion: z.preprocess((v) => (typeof v === 'string' ? v.trim() || undefined : v), z.string().max(120).default(DEFAULT_LOCATION_QUESTION)),
      peopleFlowPrefix: z.string().max(120).default(''), // "Brisbane - Youth - New People"
      consentFlowPrefix: z.string().max(120).default(''), // "Brisbane - Youth - Parent Consent"
      state: z.string().max(10).default(''), // New person default State
      fields: z.record(z.string().max(40), z.string().max(200)).default({}), // key -> Elvanto input name (Check forms)
      options: z.record(z.string().max(40), z.string().max(64)).default({}), // key -> option id (Check forms)
      checkedAt: z.string().max(40).default(''),
      busConsentFormId: uuidOrEmpty.default(''), // bus consent form (spec 2026-10-22 bus consent)
    })
    .default({}),
});

export type MinistryConfig = z.infer<typeof MinistryConfigSchema>;
export type ElvantoConfig = MinistryConfig['elvanto'];

// The inclusive list of grade numbers a deployment uses (structure.gradeMin..
// gradeMax). Replaces the hardcoded [7..12] iterations in the aggregate
// builders and the import range check. Defaults yield [7,8,9,10,11,12].
export function gradeRange(structure: { gradeMin: number; gradeMax: number }): number[] {
  const out: number[] = [];
  for (let g = structure.gradeMin; g <= structure.gradeMax; g++) out.push(g);
  return out;
}

// The one grade-range rule for manual entry points (student, account, leader, New person):
// Zod widens to 6..12, this refuses grades outside the configured range (grade 6 only when
// "Include Grade 6" is on).
export function assertGradesInRange(structure: { gradeMin: number; gradeMax: number }, grades: Iterable<number | null | undefined>): void {
  const ok = gradeRange(structure);
  for (const g of grades) if (g != null && !ok.includes(g)) throw new BadRequestError(`Grade ${g} is outside this ministry's grade range`);
}

// Applying the schema to {} yields every default in one nested object — this IS
// the canonical "empty config" value. Exported as a plain object (not a getter)
// so callers can deep-equal against it in tests without re-invoking Zod.
export const MINISTRY_CONFIG_DEFAULTS: MinistryConfig = MinistryConfigSchema.parse({});

// Per-preset overrides applied on top of the defaults when an admin picks a
// preset in the Youth Ministry Setup wizard. New locations are Junior/Senior only
// (2026-10-27, B1), so there is one preset: `large-graded-au` is intentionally `{}` —
// it IS the default, so picking it is always a no-op (acceptance criterion #1).
// 'simple' stays in MINISTRY_PRESETS only so a stored `preset: 'simple'` still parses;
// it has no entry here. serviceMinAttendance is scaled in PRESET_SERVICE_MIN_ATTENDANCE.
export const PRESET_CONFIGS: Partial<Record<MinistryPreset, Record<string, unknown>>> = {
  'large-graded-au': {},
};

// serviceMinAttendance defaults to 100 (a whole-ministry Friday-attendance floor)
// which computes zero valid services for a small ministry. Presets scale it —
// see design doc 03 §6.2 point 7 / doc 01's "one default breaks small ministries"
// finding. Applied by the Setup wizard's preset step alongside PRESET_CONFIGS,
// as a second field in the same PATCH /settings call.
export const PRESET_SERVICE_MIN_ATTENDANCE: Partial<Record<MinistryPreset, number>> = {
  'large-graded-au': 100,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge a partial patch onto a base value. Arrays and primitives in the
// patch fully replace the base value at that key; plain objects merge key-by-key.
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = isPlainObject(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject((base as Record<string, unknown> | undefined)?.[k])
      ? deepMerge((base as Record<string, unknown>)[k], v)
      : v;
  }
  return out as T;
}

// Deep-merge an arbitrary (already-validated-shape-agnostic) patch onto a full
// base config, then re-validate the merged result end to end. This is the ONLY
// path that should ever produce a stored MinistryConfig from a partial PATCH —
// callers must not merge configs by hand.
export function mergeMinistryConfig(base: MinistryConfig, patch: unknown): MinistryConfig {
  const r = MinistryConfigSchema.safeParse(deepMerge(base, patch));
  if (r.success) return r.data;
  const plain = r.error.issues.find((i) => i.message === TZ_MSG || i.message === CUTOFF_MSG);
  if (plain) throw new BadRequestError(plain.message); // the refusal in plain words
  throw r.error;
}

/** The merged modules BEFORE resolveModules, for moduleProblems (what a patch asks for, not what the resolver makes of it). */
export function mergeModulesUnresolved(base: MinistryConfig, patch: unknown): ModulesIn {
  return ModulesSchema.parse((deepMerge(base, patch) as { modules?: unknown }).modules ?? {});
}

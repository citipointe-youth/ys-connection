import type { Modules, ModulesIn } from './ministry-config';

// Modular setup (2026-10-27, design §5): the module tree, the one list of which modules a location can have and what
// each one needs. Core settings (modules.lifegroups, exportGuides) are not tree modules. The console copies this list
// byte for byte from src/tests/fixtures/module-tree.json (a test keeps the two equal).
//   parent    a sub-option: off when its parent is off
//   needsLink off when Live Elvanto link is off
//   requires  off when any of these is off
//   adminMode the module also has an "Admin only" state ('off' | 'admin' | 'on')
export type ModuleNode = { key: string; label: string; parent?: string; needsLink?: boolean; requires?: string[]; adminMode?: boolean; core?: true };

export const MODULE_TREE: readonly ModuleNode[] = [
  { key: 'prayers', label: 'Prayer' },
  { key: 'notices', label: 'Notices' },
  { key: 'digest', label: 'Digest email' },
  { key: 'busMinistry', label: 'Bus' },
  { key: 'busConsentForm', label: 'Public consent form', parent: 'busMinistry', needsLink: true },
  { key: 'newYouthForms', label: 'New person form', needsLink: true, adminMode: true },
  { key: 'intakeAdmin', label: 'Intakes', parent: 'newYouthForms' },
  { key: 'liveLink', label: 'Live Elvanto link' },
  { key: 'flows', label: 'Flows', parent: 'liveLink', adminMode: true },
  { key: 'lifegroupReport', label: 'Lifegroups', parent: 'liveLink', adminMode: true },
  { key: 'checkin', label: 'Check-in', parent: 'liveLink', adminMode: true },
  { key: 'connectionAudit', label: 'Connection Audit', requires: ['flows', 'lifegroupReport', 'newYouthForms'] },
  { key: 'camp', label: 'Camp' },
];

type Vals = Record<string, unknown>;
const isOn = (v: unknown) => v === true || v === 'on' || v === 'admin';
const offOf = (v: unknown) => (typeof v === 'boolean' ? false : 'off');
const labelOf = (k: string) => MODULE_TREE.find((n) => n.key === k)!.label;

/** What a node needs that is off in m, as tree keys (parent, then Live Elvanto link, then requires). */
function missing(n: ModuleNode, m: Vals): string[] {
  const needs = [...(n.parent ? [n.parent] : []), ...(n.needsLink ? ['liveLink'] : []), ...(n.requires ?? [])];
  return needs.filter((k) => !isOn(m[k]));
}

/** The link screens a config stored before the T10 split leaves out follow newYouthForms (rule 1). */
function filled(m: ModulesIn): Vals {
  return { ...m, checkin: m.checkin ?? m.newYouthForms, lifegroupReport: m.lifegroupReport ?? m.newYouthForms, flows: m.flows ?? m.newYouthForms };
}

/**
 * Runs inside the modules .transform: a module whose parent, link or requirement is off reads off. The tree lists every
 * parent before its children and liveLink needs nothing, so one pass in tree order applies the rules in the brief's
 * order (link screens fill, Live Elvanto link, Intakes, Bus, Connection Audit).
 */
export function resolveModules(m: ModulesIn): Modules {
  const out = filled(m);
  for (const n of MODULE_TREE) if (isOn(out[n.key]) && missing(n, out).length) out[n.key] = offOf(out[n.key]);
  return out as Modules;
}

/** Derived, never stored: the Consents hub exists when something in the app tracks consents. */
export function consentsHubOn(m: Modules): boolean {
  return m.busConsentForm || m.intakeAdmin === 'on';
}

/**
 * The rules an UNRESOLVED merged patch breaks, one plain message per on module and missing need. [] = fine to save.
 * SettingsService.update refuses a save with any, so an admin never loses a screen without being told.
 */
export function moduleProblems(m: ModulesIn): string[] {
  const v = filled(m);
  return MODULE_TREE.filter((n) => isOn(v[n.key])).flatMap((n) => missing(n, v).map((k) =>
    `${n.label} needs ${labelOf(k)}. Turn ${n.label} off first.`));
}

// Modular-setup Task 2.9 (YS half): the completeness guard. CG1 = every page / admin tab / nav id is owned by exactly one
// module or is Core. CG3 = with every non-core module off, each role's nav is the Core set. (CG2 and the console parts of CG3 are the console's.)
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { navWithModules } from './helpers/module-off';
import { MinistryConfigSchema } from '../core/ministry-config';
import { MODULE_TREE } from '../core/module-tree';
import OWNERS from './fixtures/module-owners.json';

const HTML = loadIndexHtml();
const CORE: string[] = OWNERS.core;
const MODULE_IDS = Object.fromEntries(Object.entries(OWNERS).filter(([k]) => k !== 'core')) as Record<string, string[]>;
const ROLES = ['admin', 'director', 'grade', 'quad', 'leader'];
const MODULE_KEYS = new Set([...MODULE_TREE.map((n) => n.key), 'consentsHub']);

// The shipped PAGE_MODULE: its declaration plus every Object.assign(PAGE_MODULE, …) line.
const pageModule: Record<string, string> = new Function(`${HTML.match(/^(const PAGE_MODULE = |Object\.assign\(PAGE_MODULE, ).*$/gm)!.join('\n')}\n; return PAGE_MODULE;`)(); // newline first: the Object.assign line ends in a // comment
const goTargets = [...HTML.matchAll(/\bgo\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]!);
const adminTabs: string[] = new Function(`${HTML.match(/^const ADMIN_TABS = .*$/m)![0]}; return ADMIN_TABS.map((t) => t[0]);`)();
const navIds = ROLES.flatMap((r) => Object.values(navWithModules(r)).flat());
const owners = (id: string) => Object.keys(MODULE_IDS).filter((k) => MODULE_IDS[k]!.includes(id));

describe('CG1 every page, admin tab and nav id is owned once or is Core', () => {
  const all = [...new Set([...goTargets, ...adminTabs, ...Object.keys(pageModule), ...navIds])];
  it('finds the ids it is meant to check (the scan is not empty)', () => {
    expect(goTargets.length).toBeGreaterThan(10);
    expect(adminTabs).toContain('link');
    expect(Object.keys(pageModule)).toEqual(expect.arrayContaining(['link-flows', 'link-checkin', 'link-groups'])); // the Object.assign lines count
  });
  it.each(all)('%s', (id) => {
    const o = owners(id), core = CORE.includes(id);
    expect(o.length + (core ? 1 : 0), `${id}: owners=[${o}] core=${core}`).toBe(1);
  });
  it('every PAGE_MODULE entry names a tree module, and that module is the id\'s owner in module-owners.json', () => {
    for (const [page, key] of Object.entries(pageModule)) {
      expect(MODULE_KEYS.has(key), `${page} -> ${key}`).toBe(true);
      expect(owners(page), page).toEqual([key]);
    }
  });
  it('module-owners.json names only tree modules, and lists no id twice inside one module', () => {
    for (const [k, ids] of Object.entries(MODULE_IDS)) { expect(MODULE_KEYS.has(k), k).toBe(true); expect(new Set(ids).size, k).toBe(ids.length); }
  });
});

describe('CG3 (YS) every non-core module off leaves the Core nav', () => {
  const d = MinistryConfigSchema.parse({}).modules as Record<string, unknown>;
  const allOff = Object.fromEntries(MODULE_TREE.map((n) => [n.key, typeof d[n.key] === 'boolean' ? false : 'off']));
  it.each(ROLES)('%s: every nav, bottom bar, More, quick and admin-tab id is Core', (role) => {
    const base = navWithModules(role), off = navWithModules(role, allOff);
    for (const [surface, ids] of Object.entries(off)) {
      expect(ids.filter((i) => !CORE.includes(i)), `${role} ${surface}`).toEqual([]);
      // nothing Core went with them (More alone goes when it would be empty)
      expect(ids, `${role} ${surface}`).toEqual(expect.arrayContaining(base[surface as keyof typeof base].filter((i) => CORE.includes(i) && i !== 'more')));
    }
  });
  it('every PAGE_MODULE page reads off for an admin login, so the route guard sends it Home', () => {
    const { _modOn } = loadFns(['_modOn'], `var S = ${JSON.stringify({ user: { role: 'admin' }, settings: { ministryConfig: { modules: MinistryConfigSchema.parse({ modules: allOff }).modules } } })};`);
    for (const [page, key] of Object.entries(pageModule)) expect(_modOn(key), `${page} -> ${key}`).toBe(false);
  });
});

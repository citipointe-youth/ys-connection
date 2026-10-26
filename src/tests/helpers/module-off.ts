// Modular-setup Task 2.0: the shared "module off" test helper for the YS lanes. Wraps the Task 0.2 nav harness
// (baseline-modules.spa.test.ts) so a lane test says "turn these modules off, expect exactly my ids gone".
import { expect } from 'vitest';
import { loadIndexHtml, extractFn, withPlain } from './extract-fn';
import { MinistryConfigSchema } from '../../core/ministry-config';
import LIVE_MODULES from '../fixtures/live-modules.json';

const HTML = loadIndexHtml();
// Same function list as the golden's navFor, plus _modOn and the admin tab bar. A lane that adds a function the nav calls adds it here.
export const NAV_FNS = ['_nyModeOf', '_nyMode', '_nyOn', '_linkModeOf', '_linkOn', '_linkAdminOn', '_busOn', '_prayersOn', '_modOn', 'moreItems',
  '_navItemsBase', '_navSlots', 'navItems', 'bottomNavItems', 'quickActionItems', '_navClick', '_adminTabsHtml'];
const LINE = (name: string) => HTML.match(new RegExp(`^const ${name} = .*$`, 'm'))![0];

export type NavIds = { nav: string[]; bottom: string[]; more: string[]; quick: string[]; adminTabs: string[] };

/** The ids each nav surface offers `role` on the live module states with `modsPatch` laid over them (parsed by the real schema). */
export function navWithModules(role: string, modsPatch: Record<string, unknown> = {}): NavIds {
  const ministryConfig = MinistryConfigSchema.parse({ modules: { ...LIVE_MODULES, ...modsPatch } });
  const src = withPlain(NAV_FNS.map((x) => extractFn(HTML, x)).join('\n'));
  const f = new Function('S', 'L', 'modal', 'icN', 'esc', `${LINE('ADMIN_TABS')}\n${LINE('ADMIN_TAB_HOME')}\n${src};
    return { navItems, bottomNavItems, moreItems, quickActionItems, _adminTabsHtml };`)(
    { user: { role }, page: 'home', settings: { ministryConfig } }, (k: string) => k, () => {}, (k: string) => `<i ${k}>`, (x: string) => x);
  const ids = (xs: any[]) => xs.map((i) => i.id);
  return {
    nav: ids(f.navItems()), bottom: ids(f.bottomNavItems()), more: ids(f.moreItems()), quick: ids(f.quickActionItems()),
    adminTabs: [...f._adminTabsHtml('link').matchAll(/switchAdminTab\('([^']+)'\)/g)].map((m) => m[1]),
  };
}

/** The off render is the baseline minus exactly ownedIds on every surface (ownedIds must all have been present in base). */
export function expectSubtraction(base: NavIds, withOff: NavIds, ownedIds: string[]) {
  const owned = new Set(ownedIds);
  const present = new Set(Object.values(base).flat());
  expect(ownedIds.filter((i) => !present.has(i)), 'owned ids missing from the baseline (the test would prove nothing)').toEqual([]);
  for (const k of Object.keys(base) as (keyof NavIds)[]) expect(withOff[k], k).toEqual(base[k].filter((i) => !owned.has(i)));
}

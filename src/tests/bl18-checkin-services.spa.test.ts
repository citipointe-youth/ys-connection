// Backlog lane Y2 (2026-10-18): N10 (no service picked: the 60 s refresh reloads the services) and N11 (a past
// service on a service day with no service today asks first). Real functions from public/index.html, small stubs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const html = loadIndexHtml();
const FNS = ['_lkTick', '_lkSvcReload', '_lkSvcDay', '_lkSvc', '_lkTakeServices', '_lkPickService', '_lkPickHtml', '_lkPickFoot',
  '_lkPickSel', '_lkPickUse', '_lkPastAsk', '_lkNotToday', '_lkNoTonight'];
const svc = (id: string, ymd: string, startsAt: string) => ({ serviceTimeId: id, serviceId: 's' + id, name: 'Youth', startsAt, ymd });
const LAST_SUN = svc('last', '2026-10-11', '2026-10-11T00:15:00.000Z');
const TODAY = svc('today', '2026-10-18', '2026-10-18T00:15:00.000Z');

function setup(services: any[], fresh: (p: string) => any = () => ({})) {
  const t = { fresh: [] as string[], modals: [] as string[], closed: 0, renders: 0, leaders: 0, els: {} as Record<string, any> };
  const f = new Function('__t', '__fresh', '__services', `
    const S = { user: { id: 'u' }, page: 'link-checkin' };
    let LINK = { svc: null, services: __services, defaultSvc: null, people: {}, pickSel: null, pickThen: null };
    const document = { visibilityState: 'visible', getElementById: (id) => __t.els[id] || null };
    const API = { fresh: (p) => { __t.fresh.push(p); return Promise.resolve(__fresh(p)); } };
    const esc = (s) => String(s), icS = () => '', _lkDay = (d) => 'DAY(' + d + ')', _lkTime = () => '10:15 am';
    const modal = (h) => { __t.modals.push(h); __t.els['lk-pick'] = { innerHTML: '' }; __t.els['lk-pick-foot'] = { innerHTML: '' }; };
    const closeModal = () => { __t.closed++; delete __t.els['lk-pick']; delete __t.els['lk-pick-foot']; };
    const renderLinkCheckin = async () => { __t.renders++; if (!LINK.svc) LINK.svc = LINK.defaultSvc; };
    const _lkOpenLeaders = () => { __t.leaders++; };
    const _lkOnPage = () => true, _lkTickStop = () => {}, _lkStatusLoad = () => {}, _lkRefreshView = () => {};
    const _lkLoadPeople = () => Promise.resolve(false), _ikLoad = () => {};
    ${FNS.map((n) => extractFn(html, n)).join('\n')}
    return { ${FNS.join(', ')}, get LINK() { return LINK; } };`);
  return { fns: f(t, fresh, services), t };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { vi.useRealTimers(); });

describe('N10: no service selected -> the 60 s refresh reloads the services list', () => {
  it('asks /link/checkin, takes the new default and opens it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z')); // Sun 10:00 Brisbane
    const { fns, t } = setup([LAST_SUN], () => ({ services: [TODAY, LAST_SUN], defaultServiceTimeId: 'today' }));
    fns._lkPickService();
    fns._lkTick();
    await flush(); await flush();
    expect(t.fresh).toContain('/link/checkin');
    expect(fns.LINK.services).toHaveLength(2);
    expect(t.closed).toBe(1); // the pick sheet closes
    expect(t.renders).toBe(1);
    expect(fns.LINK.svc).toBe('today');
  });
  it('no new default: the open pick sheet repaints with the new list, nothing is selected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { fns, t } = setup([], () => ({ services: [LAST_SUN], defaultServiceTimeId: null }));
    fns._lkPickService();
    fns._lkTick();
    await flush(); await flush();
    expect(fns.LINK.svc).toBeNull();
    expect(t.closed).toBe(0);
    expect(t.els['lk-pick'].innerHTML).toContain('DAY(2026-10-11)');
  });
  it('a service is selected: no services-only reload', async () => {
    const { fns, t } = setup([TODAY]);
    fns.LINK.svc = 'today';
    fns._lkTick();
    await flush();
    expect(t.fresh).not.toContain('/link/checkin');
  });
});

describe('N11: a past service on a service day with no service today asks first', () => {
  it('Sunday, no service today, last Sunday picked -> confirm, nothing selected until yes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { fns, t } = setup([LAST_SUN]);
    fns._lkPickService('leaders');
    fns._lkPickSel('last');
    await fns._lkPickUse();
    expect(fns.LINK.svc).toBeNull();
    expect(t.renders).toBe(0);
    expect(t.els['lk-pick'].innerHTML).toContain("This is last week's service. Check in to it anyway?");
    expect(t.els['lk-pick-foot'].innerHTML).toContain('_lkPickUse(true)');
    await fns._lkPickUse(true);
    expect(fns.LINK.svc).toBe('last');
    expect(t.renders).toBe(1);
    expect(t.leaders).toBe(0); // _lkOpenLeaders only when the list is loaded (stubbed empty)
  });
  it('Back returns to the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { fns, t } = setup([LAST_SUN]);
    fns._lkPickService();
    fns._lkPickSel('last');
    await fns._lkPickUse();
    expect(t.els['lk-pick-foot'].innerHTML).toContain("_lkPickSel('last')");
  });
  it('today has a service -> no confirm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { fns } = setup([TODAY, LAST_SUN]);
    fns._lkPickService();
    fns._lkPickSel('last');
    await fns._lkPickUse();
    expect(fns.LINK.svc).toBe('last');
  });
  it('not a service day (Wednesday) -> no confirm', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
    const { fns } = setup([LAST_SUN]);
    fns._lkPickService();
    fns._lkPickSel('last');
    await fns._lkPickUse();
    expect(fns.LINK.svc).toBe('last');
  });
  it('Sunday, Friday picked -> names that day instead of "last week"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-18T00:00:00Z'));
    const { fns, t } = setup([svc('fri', '2026-10-16', '2026-10-16T08:30:00.000Z')]);
    fns._lkPickService();
    fns._lkPickSel('fri');
    await fns._lkPickUse();
    expect(t.els['lk-pick'].innerHTML).toContain("This is the DAY(2026-10-16) service, not today's. Check in to it anyway?");
  });
});

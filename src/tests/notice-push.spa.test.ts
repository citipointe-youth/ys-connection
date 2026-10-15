// Notice alerts SPA: the REAL functions from public/index.html run against small stubs (extract-and-run, no browser).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const HTML = loadIndexHtml();
const FNS = ['esc', '_ntPushState', '_ntPushCardHtml', '_ntPushEnv', 'noticePushOn'];
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');

function env(o: { ua?: string; standalone?: boolean; push?: boolean; perm?: string; key?: string | null; subscribed?: boolean } = {}) {
  const calls = { perm: 0, finish: 0 };
  const prelude = `
    let _ntPushLast = null, _ntPushBusy = false;
    const icS = () => '';
    const calls = ARGS.calls;
    const Notification = { permission: ARGS.perm, requestPermission: () => { calls.perm++; return Promise.resolve('granted'); } };
    const navigator = { userAgent: ARGS.ua, platform: 'x', maxTouchPoints: 0, standalone: ARGS.standalone,
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => (ARGS.subscribed ? {} : null) } }) } };
    const window = Object.assign({ matchMedia: () => ({ matches: false }) }, ARGS.push ? { PushManager: 1, Notification: 1 } : {});
    const API = { get: async () => ({ publicKey: ARGS.key }) };
    const _ntPushFinish = () => { calls.finish++; };`;
  const args = { calls, ua: o.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130', standalone: o.standalone ?? false,
    push: o.push ?? true, perm: o.perm ?? 'default', key: o.key === undefined ? 'pubkey' : o.key, subscribed: o.subscribed ?? false };
  const f = new Function('ARGS', `${prelude}\n${BODY}\nreturn { ${FNS.join(', ')}, setLast: (v) => { _ntPushLast = v; } };`)(args);
  return { ...f, calls };
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1';

describe('notice alerts: state from the browser', () => {
  it('Android, not asked yet: off', async () => {
    const e = env();
    expect(e._ntPushState(await e._ntPushEnv())).toBe('off');
  });
  it('subscribed and granted: on', async () => {
    const e = env({ perm: 'granted', subscribed: true });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('on');
  });
  it('denied: blocked', async () => {
    const e = env({ perm: 'denied' });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('blocked');
  });
  it('no PushManager: not supported', async () => {
    const e = env({ push: false });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('unsupported');
  });
  it('iPhone in Safari (not on Home Screen): add to Home Screen first, even without PushManager', async () => {
    const e = env({ ua: IPHONE, push: false });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('ios-install');
  });
  it('iPhone Home Screen app: normal flow', async () => {
    const e = env({ ua: IPHONE, standalone: true });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('off');
  });
  it('no VAPID key on the server: not set up', async () => {
    const e = env({ key: null });
    expect(e._ntPushState(await e._ntPushEnv())).toBe('not-set-up');
  });
});

describe('notice alerts: card', () => {
  const e = env();
  it('off offers Turn on, on offers Turn off', () => {
    expect(e._ntPushCardHtml('off')).toContain('Turn on alerts');
    expect(e._ntPushCardHtml('on')).toContain('Turn off alerts');
  });
  it('other states explain and offer no button', () => {
    expect(e._ntPushCardHtml('ios-install')).toContain('Add to Home Screen');
    expect(e._ntPushCardHtml('not-set-up')).toMatch(/set up yet/);
    expect(e._ntPushCardHtml('blocked')).toMatch(/blocked by your browser/);
    expect(e._ntPushCardHtml('unsupported')).toMatch(/show alerts/);
    for (const s of ['ios-install', 'not-set-up', 'blocked', 'unsupported']) expect(e._ntPushCardHtml(s)).not.toContain('<button');
  });
});

describe('notice alerts: permission only from the tap', () => {
  it('Turn on asks for permission only while the state is off', async () => {
    const e = env();
    e.noticePushOn(); // no state drawn yet
    expect(e.calls.perm).toBe(0);
    e.setLast(await e._ntPushEnv());
    e.noticePushOn();
    expect(e.calls.perm).toBe(1);
    expect(e.calls.finish).toBe(1);
    const blocked = env({ perm: 'denied' });
    blocked.setLast(await blocked._ntPushEnv());
    blocked.noticePushOn();
    expect(blocked.calls.perm).toBe(0);
  });
  it('requestPermission appears nowhere but noticePushOn (never on load)', () => {
    const hits = HTML.split('Notification.requestPermission').length - 1;
    expect(hits).toBe(1);
    expect(extractFn(HTML, 'noticePushOn')).toContain('Notification.requestPermission');
  });
});

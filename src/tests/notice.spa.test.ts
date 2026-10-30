// Notices SPA: the REAL functions from public/index.html run against small stubs (extract-and-run, no server).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const FNS = ['esc', '_noticesOn', '_noticeSender', '_noticeToList', '_noticeCardHtml', '_noticeHomeHtml', '_noticesHtml', 'moreItems'];
const HTML = loadIndexHtml();
const BODY = FNS.map((n) => extractFn(HTML, n)).join('\n');
const QUADS = HTML.match(/^const NOTICE_QUADS = \[[\s\S]*?\];$/m)![0];

function env(role: string, notices: string) {
  const prelude = `
    const S = { user: { id: 'u', role: '${role}' }, settings: { ministryConfig: { modules: { notices: '${notices}' } } } };
    ${QUADS}
    const icS = () => '', icN = () => '';
    const _relTime = () => 'just now';
    const _prayersOn = () => true, _busOn = () => false, _nyOn = () => false, _linkOn = () => false;
    const L = (k) => k;`;
  return new Function(`${prelude}\n${BODY}\nreturn { ${FNS.join(', ')} };`)();
}
const HOSTILE = '<img src=x onerror=alert(1)>';
const note = (o: any = {}) => ({ id: 'n1', title: 't', body: 'b', recipients: ['b79'], senderName: 'Admin', createdAt: new Date().toISOString(), ...o });

describe('notices SPA', () => {
  it('module off or wrong role: no More entry, no Home card', () => {
    expect(env('admin', 'off').moreItems().map((m: any) => m.id)).not.toContain('notices');
    expect(env('grade', 'on').moreItems().map((m: any) => m.id)).not.toContain('notices');
    expect(env('admin', 'off')._noticeHomeHtml([note()])).toBe('');
  });
  it('module on: admin, oversight and quad get the More entry', () => {
    for (const r of ['admin', 'oversight', 'quad']) expect(env(r, 'on').moreItems().map((m: any) => m.id)).toContain('notices');
  });
  it('Home card shows only the last 24 hours and has no dismiss control', () => {
    const e = env('quad', 'on');
    const old = note({ id: 'old', title: 'OLD', createdAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    const html = e._noticeHomeHtml([note({ title: 'FRESH' }), old]);
    expect(html).toContain('FRESH');
    expect(html).not.toContain('OLD');
    expect(html).not.toMatch(/dismiss|button/i);
    expect(e._noticeHomeHtml([old])).toBe('');
  });
  it('escapes HTML in title, body and sender', () => {
    const html = env('admin', 'on')._noticesHtml([note({ title: HOSTILE, body: HOSTILE, senderName: HOSTILE })]);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('compose form, recipients and delete only for admin/oversight', () => {
    const adm = env('oversight', 'on')._noticesHtml([note()]);
    expect(adm).toContain('nt-send');
    expect(adm).toContain('To: Junior Guys');
    expect(adm).toContain('deleteNotice');
    const quad = env('quad', 'on')._noticesHtml([note()]);
    expect(quad).not.toContain('nt-send');
    expect(quad).not.toContain('deleteNotice');
    expect(quad).not.toContain('To:');
  });
});

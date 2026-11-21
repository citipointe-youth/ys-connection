// Consent automation A4 (R3b): a step the console saved before but Elvanto doesn't show now (the STUCK hold; rev 25 rows name its
// keys in `stuck`) offers "Check and save again" when the step is safe to repeat. The console re-reads Elvanto first and sends once
// only if it is still missing. A parent text, a note or a new profile never offers it (a second text / note / duplicate).
import { describe, it, expect } from 'vitest';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';
import * as C from '../core/link-contract';

const HTML = loadIndexHtml();
const IDEM = HTML.match(/^const IK_IDEMPOTENT = .*$/m)?.[0] ?? '';
const FNS = ['esc', '_ikStuckSteps', '_ikStuckHtml', '_ikResend'];
const P = (n: number) => `9e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STUCK = 'Saved before, not in Elvanto now';
const step = (key: string, action: string, role = 'student', state = 'todo') => ({ key, action, role, text: 't', state, alone: false, locked: false, sms: null, alts: [] });

function env(o: { postErr?: any; outcome?: string } = {}) {
  const calls = { posts: [] as any[], toasts: [] as string[], local: [] as any[] };
  const I: any = { date: '2026-11-20', tab: 'intake', key: P(9), saErr: {} };
  const f = new Function('ARGS', `const { calls, I, o } = ARGS;
    const _ik = () => I, _ikDraw = () => {}, toast = (m) => calls.toasts.push(m), _lkUuid = () => '${P(77)}';
    const _ikOutcome = (res, id) => ({ outcome: o.outcome || 'saved' });
    const _ikLocal = (k, a) => calls.local.push([k, a.type]);
    async function _ikPost(items) { calls.posts.push(items); if (o.postErr) throw o.postErr; return {}; }
    ${IDEM}
    ${FNS.map((n) => extractFn(HTML, n)).join('\n')}
    return { ${FNS.join(', ')} };`)({ calls, I, o });
  return { ...f, calls, I };
}
const det = (steps: any[], stuck: string[], consent = false) => ({ row: { key: P(9), title: 'Fam', status: 'needs-you' },
  detail: { holds: [{ role: 'student', text: STUCK }], steps, stuck, ...(consent ? { outcome: 'Contact allowed' } : {}) } });

describe('Check and save again', () => {
  it('stuck approve row shows the button; tap sends one step with resend:true', async () => {
    const e = env();
    const d = det([step('k-approve', 'approve'), step('k-text', 'complete', 'parent')], ['k-approve']);
    const h = e._ikStuckHtml(d, d.detail);
    expect(h).toContain('Check and save again');
    await e._ikResend(d);
    expect(e.calls.posts).toHaveLength(1);
    expect(e.calls.posts[0][0]).toMatchObject({ kind: 'action', type: 'intakeSave',
      payload: { date: '2026-11-20', row: P(9), confirmed: ['k-approve'], one: false, resend: true } });
    expect(C.PAYLOAD_SCHEMAS.intakeSave.safeParse(e.calls.posts[0][0].payload).success).toBe(true);
    expect(e.calls.local).toEqual([[P(9), 'intakeSave']]);
  });
  it('consent tab sends consentSave with resend:true', async () => {
    const e = env();
    e.I.tab = 'consent';
    const d = det([step('k-cnr', 'consentNotReceived')], ['k-cnr'], true);
    await e._ikResend(d);
    expect(e.calls.posts[0][0]).toMatchObject({ type: 'consentSave', payload: { confirmed: ['k-cnr'], resend: true } });
    expect(C.PAYLOAD_SCHEMAS.consentSave.safeParse(e.calls.posts[0][0].payload).success).toBe(true);
  });
  it('no button for complete/note/approveNew, with the reason shown', () => {
    const e = env();
    const cases: [string, string][] = [['complete', 'Saving again could send a second text'], ['note', 'Saving again could add a second note'],
      ['approveNew', 'Saving again could make a duplicate profile']];
    for (const [a, why] of cases) {
      const d = det([step('k', a)], ['k']);
      const h = e._ikStuckHtml(d, d.detail);
      expect(h).not.toContain('Check and save again');
      expect(h).toContain(why);
    }
  });
  it('a done step or a key not in stuck is never resent; no stuck keys = nothing shown', () => {
    const e = env();
    const d = det([step('k1', 'approve', 'student', 'done'), step('k2', 'approve')], ['k1']);
    expect(e._ikStuckSteps(d.detail)).toEqual([]);
    expect(e._ikStuckHtml(d, d.detail)).toBe('');
  });
  it('console refusal shows its message', async () => {
    const e = env({ outcome: 'refused' });
    const d = det([step('k-approve', 'approve')], ['k-approve']);
    await e._ikResend(d);
    expect(e.calls.toasts[0]).toMatch(/Not sent/);
    expect(e.calls.local).toEqual([]);
  });
  it('the idempotent list is the spec list, verbatim, and the server list', () => {
    expect(IDEM).toBe(`const IK_IDEMPOTENT = [${C.IDEMPOTENT_ACTIONS.map((a) => `'${a}'`).join(', ')}];`);
    expect(IDEM).toContain("['approve', 'unarchive', 'category', 'familyLink', 'setField', 'formFix', 'consentFix', 'consentNotReceived', 'removeFromStep', 'locDemo', 'youthDemo', 'inactivate']");
  });
});

describe('rev 25 contract', () => {
  it('LINK_REV 25; rows may name stuck keys; saves may carry resend: true only', () => {
    expect(C.LINK_REV).toBe(25);
    expect(C.PAYLOAD_SCHEMAS.intakeSave.safeParse({ date: '2026-11-20', row: P(1), confirmed: ['k'], one: false, resend: false }).success).toBe(false);
    expect(C.IntakeRow.shape.stuck).toBeTruthy();
    expect(C.ConsentRow.shape.stuck).toBeTruthy();
  });
});

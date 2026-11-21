// Consent automation (spec 2026-11-21 G1/G2): the console says a prompt is due (Fri 19:45 consentText for that Friday's intake,
// Fri 06:30 consentRecord for that Friday's consents) and sends the counts. One push per admin device, counts only (never a
// name), claimed once per (kind, date). The tap opens the "This week" sheet (screen consentweek).
import type { AlertKind } from './alert-run.service';

export function makeConsentWeekKind(kind: 'consentText' | 'consentRecord'): AlertKind {
  return {
    kind,
    async plan(ctx) {
      const d = ctx.due.find((x) => x.kind === kind);
      if (!d || !ctx.admins.length) return { skipped: null, items: [] };
      const c = d.counts;
      const body = kind === 'consentText'
        ? `${c.save} to save, ${c.text} parents to text, ${c.held} held`
        : `${c.record} to record, ${c.assume} assume, ${c.move} to move, ${c.held} held`;
      return { skipped: null, items: [{ key: d.date, leaderId: '', once: true, subs: ctx.admins,
        payload: { title: 'Consents: this week', body, tag: kind, screen: 'consentweek', mode: kind === 'consentText' ? 'intake' : 'consent', date: d.date } }] };
    },
  };
}

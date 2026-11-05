// Twin of the Supabase night-summary reads: projects the link twin's rows down to the allow-listed keys.
import type { ILinkRepository } from '../interfaces/link.repository';
import type { ILinkIntakeRepository, IntakeMode } from '../interfaces/link-intake.repository';
import type { IUnsentRepository } from '../interfaces/unsent.repository';
import type { INightSummaryRepository, NightOutboxRow, NightTapRow, NightIntakeRow, NightUnsentRow, NightRosterRow } from '../interfaces/night-summary.repository';

const OPEN = ['pending', 'claimed', 'unclear'] as const;

export class InMemoryNightSummaryRepository implements INightSummaryRepository {
  constructor(private readonly link: ILinkRepository, private readonly intake: ILinkIntakeRepository, private readonly unsentQueue: IUnsentRepository) {}

  async outbox(fromYmd: string, toYmd: string): Promise<NightOutboxRow[]> {
    const rows = await this.link.listActions({}); // all rows; the window and the open filter are applied below
    return rows
      .filter((r) => (r.serviceDate >= fromYmd && r.serviceDate <= toYmd) || (OPEN as readonly string[]).includes(r.status))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((r) => ({ type: r.type, status: r.status, reason: r.reason, serviceDate: r.serviceDate, createdAt: r.createdAt,
        resultAt: r.resultAt, attempts: r.attempts, inWindow: r.serviceDate >= fromYmd && r.serviceDate <= toYmd }));
  }

  async taps(fromIso: string, toIso: string, limit: number): Promise<NightTapRow[]> {
    const rows = await this.link.listLog({ from: fromIso, to: toIso, limit });
    return rows.map((l) => ({ at: l.at, event: l.event, outcome: l.outcome, deviceId: l.deviceId }));
  }

  private async planRows() {
    const modes: IntakeMode[] = ['intake', 'consent'];
    return (await Promise.all(modes.map((m) => this.intake.rows(m)))).flat();
  }

  async intakeRows(): Promise<NightIntakeRow[]> {
    const groups = new Map<string, NightIntakeRow>();
    for (const r of await this.planRows()) {
      const k = JSON.stringify([r.mode, r.date, r.status, r.reason]);
      const g = groups.get(k);
      if (g) g.n++; else groups.set(k, { mode: r.mode, date: r.date, status: r.status, reason: r.reason, n: 1 });
    }
    return [...groups.values()];
  }

  // The same rule as the Supabase query: exact reason, and an intake row of the same person that is needs-you.
  async notFoundHeldInIntake(): Promise<number> {
    const rows = await this.planRows();
    const held = new Set(rows.filter((r) => r.mode === 'intake' && r.status === 'needs-you' && r.personId).map((r) => r.personId));
    return rows.filter((r) => r.mode === 'consent' && r.reason === 'Not found in consent step' && r.personId && held.has(r.personId)).length;
  }

  async unsent(): Promise<NightUnsentRow[]> {
    return (await this.unsentQueue.list()).map((u) => ({ reason: u.reason, createdAt: u.createdAt }));
  }

  async roster(): Promise<NightRosterRow[]> {
    const groups = new Map<string, NightRosterRow>();
    for (const r of await this.link.roster()) {
      const hasGrade = r.grade !== null;
      const k = JSON.stringify([r.kind, r.match, r.active, hasGrade]);
      const g = groups.get(k);
      if (g) g.n++; else groups.set(k, { kind: r.kind, match: r.match, active: r.active, hasGrade, n: 1 });
    }
    return [...groups.values()];
  }
}

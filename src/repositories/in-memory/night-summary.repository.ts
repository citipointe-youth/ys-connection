// Twin of the Supabase night-summary reads: projects the link twin's rows down to the allow-listed keys.
import type { ILinkRepository } from '../interfaces/link.repository';
import type { INightSummaryRepository, NightOutboxRow, NightTapRow } from '../interfaces/night-summary.repository';

const OPEN = ['pending', 'claimed', 'unclear'] as const;

export class InMemoryNightSummaryRepository implements INightSummaryRepository {
  constructor(private readonly link: ILinkRepository) {}

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
}

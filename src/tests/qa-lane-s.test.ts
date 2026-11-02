import { describe, it, expect } from 'vitest';
import { makeImportService } from '../services/import.service';
import {
  InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository, InMemoryLifegroupWeekRepository, InMemoryLifegroupAttendanceRepository, InMemoryImportRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';

const ADMIN: Actor = { id: 'u-admin', role: 'admin', displayName: 'Admin', grade: null, quad: null };

function importer() {
  const r = {
    students: new InMemoryStudentRepository(), sessions: new InMemoryServiceSessionRepository(), attendance: new InMemoryServiceAttendanceRepository(),
    settings: new InMemorySettingsRepository(),
  };
  const svc = makeImportService(r.students, r.sessions, r.attendance, new InMemoryImportRepository(), r.settings, new InMemoryLifegroupRepository(),
    new InMemoryLifegroupWeekRepository(), new InMemoryLifegroupAttendanceRepository(), new InMemoryLeaderRepository());
  return { ...r, svc };
}
const row = (extra: Record<string, unknown> = {}) => ({ first_name: 'Amy', last_name: 'Lee', gender: 'f', grade: 8, ...extra });

describe('#18 an import with no attendance never wipes attendance', () => {
  it('refuses a roster-only file once attendance is saved, and changes nothing', async () => {
    const { svc, attendance, sessions } = importer();
    await svc.importServiceCsv(ADMIN, [row({ '2026-02-06': true })], 'full.csv');
    await expect(svc.importServiceCsv(ADMIN, [row()], 'roster.csv')).rejects.toThrow(/no attendance in it/);
    await expect(svc.importServiceCsv(ADMIN, [row({ '2026-02-13': false })], 'blank-marks.csv')).rejects.toThrow(/no attendance in it/);
    expect((await attendance.findAll()).filter((a) => a.attended)).toHaveLength(1);
    expect(await sessions.findAll()).toHaveLength(1);
  });
  it('still allows a full re-import, and a first import with no dates', async () => {
    const { svc, attendance } = importer();
    await svc.importServiceCsv(ADMIN, [row()], 'first-roster.csv');
    await svc.importServiceCsv(ADMIN, [row({ '2026-02-06': true })], 'full.csv');
    const again = await svc.importServiceCsv(ADMIN, [row({ '2026-02-13': true })], 'full2.csv');
    expect(again.sessionsAdded).toBe(1);
    expect((await attendance.findAll()).filter((a) => a.attended)).toHaveLength(1);
  });
});

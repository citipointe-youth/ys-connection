import { describe, it, expect } from 'vitest';
import { makeImportService } from '../services/import.service';
import { makeLeaderService } from '../services/leader.service';
import { makePrayerService } from '../services/prayer.service';
import { makeAccountService } from '../services/account.service';
import { setup, FRI_7PM } from './helpers/bus-setup';
import {
  InMemoryStudentRepository, InMemoryLeaderRepository, InMemoryServiceSessionRepository, InMemoryServiceAttendanceRepository,
  InMemoryLifegroupRepository, InMemoryLifegroupWeekRepository, InMemoryLifegroupAttendanceRepository, InMemoryImportRepository,
  InMemorySettingsRepository, InMemoryPrayerRepository, InMemoryUserRepository,
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

describe('#3 #20 #21 requestId on saves', () => {
  const RID = '0d7f5f0e-0000-4000-8000-000000000031';
  it('leaders: a resend returns the first; Undo after remove restores the same id with any gender', async () => {
    const repo = new InMemoryLeaderRepository();
    const svc = makeLeaderService(repo);
    const a = await svc.create(ADMIN, { fullName: 'Sam', gender: null, grades: [8], requestId: RID });
    expect(a.id).toBe(RID);
    await svc.create(ADMIN, { fullName: 'Sam', gender: null, grades: [8], requestId: RID });
    expect(await repo.findAll()).toHaveLength(1);
    await expect(svc.create(ADMIN, { fullName: 'Other', requestId: RID })).rejects.toThrow(/already used/);
    await svc.remove(ADMIN, RID);
    const back = await svc.create(ADMIN, { fullName: 'Sam', gender: null, grades: [8], requestId: RID });
    expect([back.id, back.gender]).toEqual([RID, null]);
  });
  it('prayers: a resend returns the first', async () => {
    const repo = new InMemoryPrayerRepository();
    const svc = makePrayerService(repo, new InMemoryStudentRepository());
    await svc.create(ADMIN, { studentId: null, text: 'Hi', requestId: RID });
    await svc.create(ADMIN, { studentId: null, text: 'Hi', requestId: RID });
    expect(await repo.findAll()).toHaveLength(1);
  });
  it('accounts: a resend returns the first; another username never takes over that id', async () => {
    const users = new InMemoryUserRepository();
    const svc = makeAccountService(users, new InMemorySettingsRepository());
    const body = { displayName: 'New', email: 'newlogin', password: 'password1', role: 'oversight', requestId: RID };
    const a = await svc.create(ADMIN, body);
    expect((await svc.create(ADMIN, body)).id).toBe(a.id);
    await expect(svc.create(ADMIN, { ...body, email: 'other' })).rejects.toThrow(/already used/);
    await expect(svc.create(ADMIN, { ...body, requestId: undefined })).rejects.toThrow(/already in use/);
  });
  it('vehicles: a resend returns the first', async () => {
    const { svc, bus, ctx } = await setup();
    const v = { name: 'Van', seats: 8, endsAt: 'church', endsAddress: null, endsPlaceId: null, requestId: RID };
    const a = await svc.saveVehicle(ctx('admin', null, FRI_7PM), v);
    await svc.saveVehicle(ctx('admin', null, FRI_7PM), v);
    expect(a.id).toBe(RID);
    expect((await bus.listVehicles()).filter((x) => x.name === 'Van')).toHaveLength(1);
  });
});

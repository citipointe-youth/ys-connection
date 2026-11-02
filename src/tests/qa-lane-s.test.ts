import { describe, it, expect } from 'vitest';
import { makeImportService } from '../services/import.service';
import { makeLeaderService } from '../services/leader.service';
import { isRealDob } from '../services/terms';
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

describe('#15 a blank-grade leader on a quad login', () => {
  const quad = { id: 'q', role: 'quad', displayName: 'Junior Girls', grade: null, quad: 'g79' } as unknown as Actor;
  it('gets 7-9 with Include Grade 6 off (the default), 6-9 with it on', async () => {
    const settings = new InMemorySettingsRepository();
    const svc = makeLeaderService(new InMemoryLeaderRepository(), settings);
    expect((await svc.create(quad, { fullName: 'Blank' })).grades).toEqual([7, 8, 9]);
    const cfg = (await settings.getSettings()).ministryConfig;
    await settings.updateSettings({ ministryConfig: { ...cfg, structure: { ...cfg.structure, gradeMin: 6 } } });
    expect((await svc.create(quad, { fullName: 'Blank 6' })).grades).toEqual([6, 7, 8, 9]);
  });
});

describe('#26 unknown gender, BRK-14 impossible dates', () => {
  it('lists a blank gender in the report; a later file fills it; a blank cell never clears a known one', async () => {
    const { svc, students } = importer();
    const r = await svc.importServiceCsv(ADMIN, [row({ gender: '' })], 'a.csv');
    expect(r.report.warnings).toEqual([{ name: 'Amy Lee', reason: expect.stringContaining('no gender recorded') }]);
    const again = await svc.importServiceCsv(ADMIN, [row()], 'b.csv');
    expect(again.report.warnings).toEqual([]);
    await svc.importServiceCsv(ADMIN, [row({ gender: '' })], 'c.csv');
    const [s] = await students.findAll();
    expect([s!.gender, s!.quad]).toEqual(['female', 'g79']);
  });
  it('an impossible date of birth is not saved, and is reported', async () => {
    const { svc, students } = importer();
    const r = await svc.importServiceCsv(ADMIN, [row({ date_of_birth: '32/13/2099' })], 'a.csv');
    expect((await students.findAll())[0]!.dateOfBirth).toBeNull();
    expect(r.report.warnings[0]!.reason).toContain('not a real date');
    await svc.importServiceCsv(ADMIN, [row({ date_of_birth: '1/2/2012' })], 'b.csv');
    expect((await students.findAll())[0]!.dateOfBirth).toBe('2012-02-01');
  });
  it('isRealDob', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(['2012-02-29', '1900-01-01'].every((d) => isRealDob(d, now))).toBe(true);
    expect(['2013-02-29', '2099-13-32', '3000-01-01', '1800-01-01', 'junk'].some((d) => isRealDob(d, now))).toBe(false);
  });
});

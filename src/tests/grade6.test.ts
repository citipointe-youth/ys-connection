import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeStudentService } from '../services/student.service';
import { makeAccountService } from '../services/account.service';
import { makeLeaderService } from '../services/leader.service';
import { makeNewYouthService } from '../services/new-youth.service';
import * as EF from '../services/elvanto-forms';
import {
  InMemoryStudentRepository, InMemoryUserRepository, InMemoryLeaderRepository, InMemorySettingsRepository,
} from '../repositories/in-memory';
import { MINISTRY_CONFIG_DEFAULTS } from '../core/ministry-config';
import type { Actor } from '../core/entities/user';

const ADMIN: Actor = { id: 'a', role: 'admin' as any, displayName: 'A', grade: null as any, quad: null as any };
const studentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-student-form.html'), 'utf8');
const parentHtml = readFileSync(join(__dirname, 'fixtures/elvanto-parent-form.html'), 'utf8');

async function settings(gradeMin: 6 | 7) {
  const repo = new InMemorySettingsRepository();
  await repo.init();
  await repo.updateSettings({
    ministryConfig: {
      ...MINISTRY_CONFIG_DEFAULTS,
      structure: { ...MINISTRY_CONFIG_DEFAULTS.structure, gradeMin },
      modules: { ...MINISTRY_CONFIG_DEFAULTS.modules, newYouthForms: 'on' },
    },
  } as any);
  return repo;
}

describe.each([[6, true], [7, false]] as const)('Include Grade 6 (gradeMin=%i): grade 6 accepted=%s', (gradeMin, ok) => {
  const verdict = async (p: Promise<unknown>) => {
    if (ok) await expect(p).resolves.toBeTruthy();
    else await expect(p).rejects.toThrow();
  };

  it('student create + update', async () => {
    const repo = new InMemoryStudentRepository(); await repo.init();
    const svc = makeStudentService(repo, await settings(gradeMin));
    const base = { firstName: 'A', lastName: 'B', gender: 'female' };
    await verdict(svc.create(ADMIN, { ...base, grade: 6 }));
    const s = await svc.create(ADMIN, { ...base, grade: 9 });
    await verdict(svc.update(ADMIN, s.id, { grade: 6 }));
  });

  it('account create (grade + grades)', async () => {
    const users = new InMemoryUserRepository(); await users.init();
    const svc = makeAccountService(users, await settings(gradeMin));
    const base = { displayName: 'G', password: 'password123', role: 'grade', gender: 'female' };
    await verdict(svc.create(ADMIN, { ...base, email: 'g6a', grade: 6 }));
    await verdict(svc.create(ADMIN, { ...base, email: 'g6b', grades: [6, 7] }));
  });

  it('leader create + updateGrades', async () => {
    const repo = new InMemoryLeaderRepository(); await repo.init();
    const svc = makeLeaderService(repo, await settings(gradeMin));
    await verdict(svc.create(ADMIN, { fullName: 'L', grades: [6] }));
    const l = await svc.create(ADMIN, { fullName: 'M', grades: [8] });
    await verdict(svc.updateGrades(ADMIN, l.id, [6, 8]));
  });

  it('new person form', async () => {
    const fetchFn = (async (url: any) => new Response(String(url).includes(EF.STUDENT_FORM_ID) ? studentHtml : parentHtml, { status: 200 })) as typeof fetch;
    const svc = makeNewYouthService(await settings(gradeMin), { fetchFn });
    const input = {
      host: 'Sam', firstName: 'Alex', lastName: 'Test', dob: '2014-04-03', gender: 'f', grade: '6', school: 'CCC',
      mobile: '0412345678', allergies: [], conditions: [], medicalNotes: '',
      parentFirst: 'Pat', parentLast: 'Test', parentMobile: '0498765432',
    };
    await verdict(svc.send(ADMIN, input));
  });
});

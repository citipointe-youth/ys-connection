// navfix n1 (server): C-B6 / D3 notices send is idempotent on a client requestId.
import { describe, it, expect } from 'vitest';
import { InMemoryNoticeRepository } from '../repositories/in-memory/in-memory.repositories';
import { makeNoticeService } from '../services/notice.service';
import type { Actor } from '../core/entities/user';

const admin = { id: 'admin-1', role: 'admin', displayName: 'Admin', grade: null, quad: null } as unknown as Actor;
const settings = { getSettings: async () => ({ ministryConfig: { modules: { notices: 'on' } } }) } as any;
const RID = '6f1c2a5e-3b4d-4e8f-9a1b-2c3d4e5f6a7b';

describe('C-B6 notice requestId', () => {
  it('same requestId twice -> one notice, same id returned', async () => {
    const repo = new InMemoryNoticeRepository();
    const svc = makeNoticeService(repo, settings);
    const a = await svc.send(admin, { title: 't', body: 'b', recipients: ['b79'], requestId: RID });
    const b = await svc.send(admin, { title: 't', body: 'b', recipients: ['b79'], requestId: RID });
    expect(a.id).toBe(RID);
    expect(b.id).toBe(RID);
    expect((await repo.findAll()).length).toBe(1);
  });
  it('no requestId -> a fresh id each send (unchanged)', async () => {
    const repo = new InMemoryNoticeRepository();
    const svc = makeNoticeService(repo, settings);
    await svc.send(admin, { title: 't', body: 'b', recipients: ['b79'] });
    await svc.send(admin, { title: 't', body: 'b', recipients: ['b79'] });
    expect((await repo.findAll()).length).toBe(2);
  });
  it('requestId must be a uuid', async () => {
    const svc = makeNoticeService(new InMemoryNoticeRepository(), settings);
    await expect(svc.send(admin, { title: 't', body: 'b', recipients: ['b79'], requestId: 'x' })).rejects.toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { makeConnectionAuditService } from '../services/connection-audit.service';
import {
  InMemoryConnectionAuditRepository,
  InMemorySettingsRepository,
} from '../repositories/in-memory';
import type { Actor } from '../core/entities/user';
import { ForbiddenError, ModuleDisabledError } from '../core/errors/app-error';

function actor(role: string): Actor {
  return { id: 'a', role: role as any, displayName: 'T', grade: null as any, quad: null as any };
}

async function buildRepos() {
  const repo = new InMemoryConnectionAuditRepository();
  const settings = new InMemorySettingsRepository();
  await Promise.all([repo.init(), settings.init()]);
  await settings.updateSettings({ serviceMinAttendance: 1 }); // tiny test data
  const service = makeConnectionAuditService(repo, settings);
  return { service, repo, settings };
}

// A stored year (v1-shaped; the old 6-slot upload is gone, spec 2026-10-22 §5.1).
async function seed(repo: InMemoryConnectionAuditRepository) {
  await repo.save({ id: '2026', year: 2026, label: '2026', uploadedBy: 'console', uploadedAt: '2026-10-16T11:10:00.000Z',
    snapshot: { generatedAt: '2026-10-16T11:10:00.000Z', dataStartDate: null, dataEndDate: null, terms: [], students: [],
      perTerm: {}, lgStatsByTerm: {}, uploads: { team: [], connect: [], decision: [], flows: [] } } } as any);
}

describe('ConnectionAuditService', () => {
  it('the old 6-slot upload is gone', async () => {
    const { service } = await buildRepos();
    expect((service as unknown as Record<string, unknown>)['upload']).toBeUndefined();
  });
  it('get returns the stored audit; remove deletes it', async () => {
    const { service, repo } = await buildRepos();
    await seed(repo);
    expect(await service.get(actor('admin'), 2026)).not.toBeNull();
    await service.remove(actor('admin'), 2026);
    expect(await service.get(actor('admin'), 2026)).toBeNull();
  });
  it('rejects a grade login', async () => {
    const { service } = await buildRepos();
    await expect(service.list(actor('grade'))).rejects.toThrow(ForbiddenError);
  });
});

describe('ConnectionAuditService — modules.connectionAudit toggle', () => {
  async function disable(settings: InMemorySettingsRepository) {
    const current = await settings.getSettings();
    await settings.updateSettings({
      ministryConfig: { ...current.ministryConfig, modules: { ...current.ministryConfig.modules, connectionAudit: false } },
    });
  }
  it('list/get/remove/exportAll/importAll all throw ModuleDisabledError when off', async () => {
    const { service, settings } = await buildRepos();
    await disable(settings);
    await expect(service.list(actor('admin'))).rejects.toThrow(ModuleDisabledError);
    await expect(service.get(actor('admin'), 2026)).rejects.toThrow(ModuleDisabledError);
    await expect(service.remove(actor('admin'), 2026)).rejects.toThrow(ModuleDisabledError);
    await expect(service.exportAll(actor('admin'))).rejects.toThrow(ModuleDisabledError);
    await expect(service.importAll(actor('admin'), [])).rejects.toThrow(ModuleDisabledError);
  });
  it('does not drop existing audit data when toggled off then back on', async () => {
    const { service, settings, repo } = await buildRepos();
    await seed(repo);
    await disable(settings);
    await expect(service.list(actor('admin'))).rejects.toThrow(ModuleDisabledError);
    const current = await settings.getSettings();
    await settings.updateSettings({
      ministryConfig: { ...current.ministryConfig, modules: { ...current.ministryConfig.modules, connectionAudit: true } },
    });
    expect(await service.list(actor('admin'))).toHaveLength(1);
  });
});

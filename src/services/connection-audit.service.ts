import { z } from 'zod';
import { assertCan } from './access-control';
import type { IConnectionAuditRepository, ISettingsRepository } from '../repositories/interfaces/entity-repositories';
import type { Actor } from '../core/entities/user';
import type { ConnectionAudit } from '../core/entities/connection-audit';
import { ModuleDisabledError } from '../core/errors/app-error';
import type { AppSettings } from '../core/entities/settings';

// Service-level module-disabled guard (matches the "validation inside
// services" house rule) — called at the top of every method below.
function requireCaModule(settings: AppSettings): void {
  if (settings.ministryConfig.modules.connectionAudit === false) {
    throw new ModuleDisabledError('Connection Audit');
  }
}

import type { AuditSummary } from '../repositories/interfaces/entity-repositories';
export type { AuditSummary };

// Exact round-trip backup/restore format for the New Year Refresh wizard: the
// raw ConnectionAudit rows as exported by exportAll(), trusted as our own
// previously-exported shape — snapshot is opaque here (already validated when
// it was originally built by the audit build).
const ImportAllSchema = z.array(z.object({
  id: z.string(),
  year: z.number(),
  label: z.string(),
  uploadedBy: z.string(),
  uploadedAt: z.string(),
  snapshot: z.unknown(),
}));

export interface ConnectionAuditService {
  list(actor: Actor): Promise<AuditSummary[]>;
  get(actor: Actor, year: number): Promise<ConnectionAudit | null>;
  remove(actor: Actor, year: number): Promise<void>;
  // Full-fidelity backup/restore of every saved year, used by the New Year
  // Refresh wizard to survive a Full Reset (which wipes connection_audits).
  // Exact round-trip: exports the raw ConnectionAudit rows as-is.
  exportAll(actor: Actor): Promise<ConnectionAudit[]>;
  importAll(actor: Actor, input: unknown): Promise<{ imported: number }>;
}

export function makeConnectionAuditService(
  repo: IConnectionAuditRepository,
  settingsRepo: ISettingsRepository,
): ConnectionAuditService {
  return {
    async list(actor) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      const all = await repo.findAll();
      return all
        .sort((a, b) => b.year - a.year)
        .map((a) => ({ year: a.year, label: a.label, uploadedAt: a.uploadedAt, termKeys: a.snapshot.terms.map((t) => t.key) }));
    },

    async get(actor, year) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      return repo.findByYear(year);
    },

    async remove(actor, year) {
      assertCan(actor, 'import:run');
      requireCaModule(await settingsRepo.getSettings());
      await repo.delete(String(year));
    },

    async exportAll(actor) {
      assertCan(actor, 'admin:manage');
      requireCaModule(await settingsRepo.getSettings());
      const all = await repo.findAll();
      return all.sort((a, b) => a.year - b.year);
    },

    async importAll(actor, input) {
      assertCan(actor, 'admin:manage');
      requireCaModule(await settingsRepo.getSettings());
      const rows = ImportAllSchema.parse(input);
      for (const row of rows) {
        await repo.save(row as unknown as ConnectionAudit);
      }
      return { imported: rows.length };
    },
  };
}

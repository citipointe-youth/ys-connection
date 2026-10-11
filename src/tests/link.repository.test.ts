import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { describeLinkRepo } from './helpers/link-repo-suite';

describeLinkRepo('memory', async (opts) => {
  const repo = new InMemoryLinkRepository({ decrypt: opts?.decrypt });
  return {
    repo,
    backdate: async (table, id, column, iso) => repo._backdate(table, id, column, iso),
    peekNote: async (id) => repo._peekNote(id),
    cleanup: async () => {},
  };
});

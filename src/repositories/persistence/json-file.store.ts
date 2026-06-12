import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IPersistenceAdapter } from './persistence';

export class JsonFilePersistence<T> implements IPersistenceAdapter<T> {
  constructor(private readonly filePath: string) {}

  async read(): Promise<T[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }

  async write(items: T[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(items, null, 2), 'utf-8');
  }
}

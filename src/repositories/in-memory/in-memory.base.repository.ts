import type { IRepository } from '../interfaces/base.repository';

export class InMemoryBaseRepository<T extends { id: string }> implements IRepository<T> {
  protected store: Map<string, T> = new Map();

  protected clone(entity: T): T {
    return JSON.parse(JSON.stringify(entity)) as T;
  }

  async init(): Promise<void> {
    this.store.clear();
  }

  async findById(id: string): Promise<T | null> {
    const item = this.store.get(id);
    return item ? this.clone(item) : null;
  }

  async findAll(): Promise<T[]> {
    return Array.from(this.store.values()).map((item) => this.clone(item));
  }

  async save(entity: T): Promise<T> {
    const cloned = this.clone(entity);
    this.store.set(cloned.id, cloned);
    return this.clone(cloned);
  }

  async delete(id: string): Promise<boolean> {
    const existed = this.store.has(id);
    if (existed) {
      this.store.delete(id);
    }
    return existed;
  }

  async deleteAll(): Promise<void> {
    this.store.clear();
  }
}

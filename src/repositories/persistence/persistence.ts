export interface IPersistenceAdapter<T> {
  read(): Promise<T[]>;
  write(items: T[]): Promise<void>;
}

export class NullPersistence<T> implements IPersistenceAdapter<T> {
  async read(): Promise<T[]> { return []; }
  async write(_items: T[]): Promise<void> {}
}

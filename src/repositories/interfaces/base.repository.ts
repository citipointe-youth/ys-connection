export interface IRepository<T extends { id: string }> {
  init(): Promise<void>;
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<boolean>;
}

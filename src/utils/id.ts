import { randomBytes } from 'node:crypto';

export function generateId(): string {
  return randomBytes(12).toString('hex');
}

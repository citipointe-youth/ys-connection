import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = process.env['VITEST'] ? 4 : 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return bcrypt.compare(password, stored);
}

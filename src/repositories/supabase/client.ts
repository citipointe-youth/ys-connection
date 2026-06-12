import postgres from 'postgres';
import { env } from '../../config/env';

export type SqlClient = ReturnType<typeof postgres>;

let _client: SqlClient | undefined;

export function getSqlClient(): SqlClient {
  if (!_client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE=supabase');
    _client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  }
  return _client;
}

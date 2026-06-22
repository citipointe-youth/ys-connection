import postgres from 'postgres';
import { env } from '../../config/env';

export type SqlClient = ReturnType<typeof postgres>;

// Coerce a DB timestamp column to an ISO string without ever throwing. The porsager
// driver normally returns a Date for timestamptz, but a null/string/number (or a
// row mangled by a transient pooler hiccup) used to blow up `(x as Date).toISOString()`
// with a TypeError -> 500. For a real Date this is identical to the old cast.
export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return new Date(v).toISOString();
  return new Date().toISOString();
}

let _client: SqlClient | undefined;

export function getSqlClient(): SqlClient {
  if (!_client) {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE=supabase');
    _client = postgres(env.DATABASE_URL, {
      // Pool size per serverless instance. max:1 caused head-of-line blocking —
      // one slow query (an import, or /trends scanning attendance) would hold the
      // ONLY connection and freeze every other request in the instance, including
      // login. The Supabase transaction pooler (port 6543) multiplexes these, so a
      // small pool is safe and lets concurrent requests (e.g. the 7 post-login
      // prefetches) run in parallel instead of serialising.
      max: 5,
      prepare: false,
      idle_timeout: 10,    // close idle connections after 10s (prevents stale TCP in serverless)
      max_lifetime: 60,    // never keep a connection longer than 60s
      connect_timeout: 10, // fail fast if the DB doesn't respond (cold starts can be slow)
      connection: {
        statement_timeout: 15000,  // kill any query running > 15s (prevents indefinite hangs)
      },
    });
  }
  return _client;
}

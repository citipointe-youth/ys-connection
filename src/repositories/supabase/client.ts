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
      // ONLY connection and freeze every other request in the instance. But on the
      // free-tier Supavisor pool, a burst of concurrent Lambda instances each opening
      // up to `max` fresh backend connections at once (e.g. Home's ~9-request
      // fan-out landing on several cold instances simultaneously) can exceed the
      // pooler's real capacity and stall new connection ACQUISITION for 20s+ — this
      // showed up as /connections/leader/:id/followup 503s that survived both
      // parallelizing its queries and a client-side retry (2026-07-05). 2 is enough
      // to avoid single-connection head-of-line blocking while roughly halving the
      // peak simultaneous new-connection demand per request vs the old max:5.
      max: 2,
      prepare: false,
      // idle_timeout/max_lifetime were tuned low (30s/60s) specifically to recycle
      // connections quickly, but that means even a warm, actively-used Lambda
      // instance is forced to tear down and re-establish a DB connection (fresh
      // TCP+TLS to the pooler) almost every request — Postgres logs show new
      // connection authorizations every 15-30s all session long. Each of those
      // re-establishments is a chance to hit the free-tier pool's occasional slow
      // handshake. Raised both so a warm instance reuses its connections across many
      // more requests instead of constantly reconnecting; still well within a
      // typical Lambda's warm lifetime, so a going-cold instance still cleans up.
      idle_timeout: 120,
      max_lifetime: 300,
      connect_timeout: 10, // fail fast if the DB doesn't respond (cold starts can be slow)
      connection: {
        statement_timeout: 15000,  // kill any query running > 15s (prevents indefinite hangs)
      },
    });
  }
  return _client;
}

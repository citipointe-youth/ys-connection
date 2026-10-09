export type UrlCheck = { ok: true; host: string } | { ok: false; message: string };

/** Checks DATABASE_URL before any connection. Messages never contain the URL or the password. */
export function checkDatabaseUrl(url: string): UrlCheck {
  let u: URL;
  try { u = new URL(url); } catch {
    return { ok: false, message: 'Database update failed: DATABASE_URL is not a valid connection string. If the database password has symbols, reset it in Supabase to letters and numbers only. Then copy the connection string again.' };
  }
  if (u.port === '6543') {
    return { ok: false, message: 'Database update stopped: DATABASE_URL uses port 6543 (Transaction pooler). Copy the Session pooler string, which uses port 5432. Paste it as DATABASE_URL in Vercel. Then redeploy.' };
  }
  return { ok: true, host: u.hostname };
}

import { normalisePrivateKey, type GoogleConfig } from './google-routing-provider';

export interface GoogleConfigStatus { state: 'off' | 'partial' | 'on'; missing: string[] }
const BAD_JSON = 'GOOGLE_SA_JSON (not a valid key file. Paste the whole key file again.)';
const OLD = ['GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GOOGLE_PROJECT_ID'] as const;

function parseKeyFile(raw: string | undefined): { saEmail: string; saPrivateKey: string; projectId: string } | null {
  if (!raw || !raw.trim()) return null;
  try {
    const j = JSON.parse(raw.trim()) as Record<string, unknown>;
    const email = j['client_email'], key = j['private_key'], project = j['project_id'];
    if (typeof email !== 'string' || typeof key !== 'string' || typeof project !== 'string' || !email || !key || !project) return null;
    return { saEmail: email, saPrivateKey: normalisePrivateKey(key), projectId: project };
  } catch { return null; }
}

/** The routing credentials, or null. GOOGLE_SA_JSON (when valid) wins over the old three vars. */
export function googleConfigFromEnv(e: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const apiKey = e['GOOGLE_MAPS_API_KEY'];
  if (!apiKey) return null;
  const fromJson = parseKeyFile(e['GOOGLE_SA_JSON']);
  if (fromJson) return { apiKey, ...fromJson };
  const saEmail = e['GOOGLE_SA_EMAIL'], key = e['GOOGLE_SA_PRIVATE_KEY'], projectId = e['GOOGLE_PROJECT_ID'];
  if (saEmail && key && projectId) return { apiKey, saEmail, saPrivateKey: normalisePrivateKey(key), projectId };
  return null;
}

export function googleConfigStatus(e: NodeJS.ProcessEnv = process.env): GoogleConfigStatus {
  // A GOOGLE_SA_JSON that is present but invalid is never 'on', even if the old three vars still work
  // (routing keeps using them as a fallback, so an existing deployment does not break).
  const jsonBad = !!e['GOOGLE_SA_JSON']?.trim() && !parseKeyFile(e['GOOGLE_SA_JSON']);
  if (!jsonBad && googleConfigFromEnv(e)) return { state: 'on', missing: [] };
  const hasJson = !!e['GOOGLE_SA_JSON']?.trim();
  const oldSet = OLD.filter((k) => !!e[k]);
  const hasKey = !!e['GOOGLE_MAPS_API_KEY'];
  if (!hasJson && oldSet.length === 0 && !hasKey) return { state: 'off', missing: [] };
  const missing: string[] = [];
  if (hasJson && !parseKeyFile(e['GOOGLE_SA_JSON'])) missing.push(BAD_JSON);
  else if (!hasJson && oldSet.length > 0) missing.push(...OLD.filter((k) => !e[k]));
  else if (!hasJson) missing.push('GOOGLE_SA_JSON');
  if (!hasKey) missing.push('GOOGLE_MAPS_API_KEY');
  return { state: 'partial', missing };
}

export function googleStatusText(s: GoogleConfigStatus): string {
  if (s.state === 'on') return 'Google: connected.';
  if (s.state === 'off') return 'Google: not set up. Bus uses test routes.';
  return `Google: part set up. Missing: ${s.missing.join(', ')}.`;
}

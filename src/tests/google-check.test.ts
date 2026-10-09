import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { checkGoogleConnection, classifyGoogleError } from '../services/routing/google-check';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const cfg = { apiKey: 'AIzaSECRET', saEmail: 'a@p.iam.gserviceaccount.com', saPrivateKey: pem, projectId: 'p1' };
const errBody = (status: number, reason: string, message = 'msg') =>
  JSON.stringify({ error: { code: status, message, details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } });

type Handler = (url: string) => { status: number; body: string };
function fakeFetch(h: Handler): typeof fetch {
  return (async (input: string | URL) => {
    const { status, body } = h(String(input));
    return new Response(body, { status });
  }) as typeof fetch;
}
const okAll: Handler = (url) =>
  url.includes('oauth2') ? { status: 200, body: JSON.stringify({ access_token: 't', expires_in: 3600 }) }
  : url.includes('staticmap') ? { status: 200, body: 'PNG' }
  : { status: 200, body: '{}' };

describe('classifyGoogleError', () => {
  it('SERVICE_DISABLED names the API', () => {
    expect(classifyGoogleError('places', 403, errBody(403, 'SERVICE_DISABLED'), cfg.apiKey))
      .toBe('Places API (New) is off. In Google Cloud, open APIs & Services. Turn on Places API (New).');
  });
  it('IAM_PERMISSION_DENIED and any 403 on Route Optimization', () => {
    const t = 'The service account cannot use Route Optimization. In Google Cloud, give it the role Route Optimization Editor.';
    expect(classifyGoogleError('routeopt', 403, errBody(403, 'IAM_PERMISSION_DENIED'), cfg.apiKey)).toBe(t);
    expect(classifyGoogleError('routeopt', 403, '{}', cfg.apiKey)).toBe(t);
  });
  it('BILLING_DISABLED', () => {
    expect(classifyGoogleError('routes', 403, errBody(403, 'BILLING_DISABLED'), cfg.apiKey)).toBe('Billing is off for this Google project. Turn on billing.');
  });
  it('API_KEY_INVALID / API_KEY_SERVICE_BLOCKED', () => {
    const t = 'The API key is not valid, or its restrictions block this API. Check the key and its API restrictions.';
    expect(classifyGoogleError('places', 400, errBody(400, 'API_KEY_INVALID'), cfg.apiKey)).toBe(t);
    expect(classifyGoogleError('routes', 403, errBody(403, 'API_KEY_SERVICE_BLOCKED'), cfg.apiKey)).toBe(t);
  });
  it('Static Maps 403 by status alone', () => {
    expect(classifyGoogleError('staticmap', 403, 'The Google Maps Platform server rejected your request', cfg.apiKey))
      .toBe('Maps Static API is off, or the API key blocks it.');
  });
  it('other: echoes only error.message, with the key masked', () => {
    expect(classifyGoogleError('routes', 500, errBody(500, 'X', 'boom AIzaSECRET'), cfg.apiKey)).toBe('Google reported: boom ***.');
    expect(classifyGoogleError('routes', 500, 'not json AIzaSECRET', cfg.apiKey)).toBe('Google reported: error 500.');
  });
});

describe('checkGoogleConnection', () => {
  it('five OK rows when everything answers', async () => {
    const rows = await checkGoogleConnection(cfg, fakeFetch(okAll));
    expect(rows.map((r) => [r.id, r.ok])).toEqual([['signin', true], ['routeopt', true], ['places', true], ['routes', true], ['staticmap', true]]);
  });
  it('sign-in failure marks Route Optimization as not tested', async () => {
    const rows = await checkGoogleConnection(cfg, fakeFetch((u) => u.includes('oauth2') ? { status: 400, body: '{"error":"invalid_grant"}' } : okAll(u)));
    expect(rows[0]).toMatchObject({ id: 'signin', ok: false });
    expect(rows[1]).toMatchObject({ id: 'routeopt', ok: false, fix: 'Fix Sign-in first.' });
    expect(rows[2]!.ok).toBe(true);
  });
  it('sends VALIDATE_ONLY to Route Optimization and never puts the key in a fix', async () => {
    let roBody = '';
    const f = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('optimizeTours')) { roBody = String(init?.body); return new Response(errBody(403, 'SERVICE_DISABLED', 'AIzaSECRET'), { status: 403 }); }
      const r = okAll(url); return new Response(r.body, { status: r.status });
    }) as typeof fetch;
    const rows = await checkGoogleConnection(cfg, f);
    expect(JSON.parse(roBody).solvingMode).toBe('VALIDATE_ONLY');
    expect(JSON.stringify(rows)).not.toContain('AIzaSECRET');
  });
});

describe('buildValidateOnlyBody', () => {
  it('is VALIDATE_ONLY with 1 vehicle, 1 shipment, lat/lng only (no place ids)', async () => {
    const { buildValidateOnlyBody } = await import('../services/routing/google-check');
    const b = buildValidateOnlyBody(0);
    expect(b.solvingMode).toBe('VALIDATE_ONLY');
    expect(b.model.vehicles.length).toBe(1);
    expect(b.model.shipments.length).toBe(1);
    expect(JSON.stringify(b)).not.toContain('placeId');
  });
});

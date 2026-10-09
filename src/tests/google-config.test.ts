import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { googleConfigFromEnv, googleConfigStatus, googleStatusText } from '../services/routing/google-config';
import { googleRoutingEnabled } from '../services/routing/google-routing-provider';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyFile = { type: 'service_account', project_id: 'p1', client_email: 'ys-bus@p1.iam.gserviceaccount.com', private_key: pem };
const json = JSON.stringify(keyFile);

describe('googleConfigFromEnv', () => {
  it('reads GOOGLE_SA_JSON (compact)', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' });
    expect(c).toMatchObject({ apiKey: 'k', saEmail: keyFile.client_email, projectId: 'p1' });
    expect(c!.saPrivateKey).toContain('-----BEGIN PRIVATE KEY-----\n');
  });
  it('reads pretty-printed JSON with surrounding whitespace', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: `\n  ${JSON.stringify(keyFile, null, 2)}  \n`, GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('p1');
  });
  it('normalises a \\n-escaped private_key', () => {
    const escaped = JSON.stringify({ ...keyFile, private_key: pem.replace(/\n/g, '\\n') });
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: escaped, GOOGLE_MAPS_API_KEY: 'k' })!.saPrivateKey.split('\n')[0]).toBe('-----BEGIN PRIVATE KEY-----');
  });
  it('still accepts the old three variables', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_EMAIL: 'a@b', GOOGLE_SA_PRIVATE_KEY: pem, GOOGLE_PROJECT_ID: 'old', GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('old');
  });
  it('GOOGLE_SA_JSON wins when both are set', () => {
    const c = googleConfigFromEnv({ GOOGLE_SA_JSON: json, GOOGLE_SA_EMAIL: 'a@b', GOOGLE_SA_PRIVATE_KEY: pem, GOOGLE_PROJECT_ID: 'old', GOOGLE_MAPS_API_KEY: 'k' });
    expect(c?.projectId).toBe('p1');
  });
  it('returns null without GOOGLE_MAPS_API_KEY, or with invalid JSON and no old vars', () => {
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: json })).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: '{bad', GOOGLE_MAPS_API_KEY: 'k' })).toBeNull();
    expect(googleConfigFromEnv({ GOOGLE_SA_JSON: JSON.stringify({ project_id: 'p' }), GOOGLE_MAPS_API_KEY: 'k' })).toBeNull();
  });
});

describe('googleConfigStatus', () => {
  it('off when nothing is set', () => expect(googleConfigStatus({})).toEqual({ state: 'off', missing: [] }));
  it('on with the two new values', () => expect(googleConfigStatus({ GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' }).state).toBe('on'));
  it('partial: bad JSON', () => {
    expect(googleConfigStatus({ GOOGLE_SA_JSON: '{bad', GOOGLE_MAPS_API_KEY: 'k' })).toEqual({
      state: 'partial', missing: ['GOOGLE_SA_JSON (not a valid key file. Paste the whole key file again.)'] });
  });
  it('partial: key file present, API key missing', () => {
    expect(googleConfigStatus({ GOOGLE_SA_JSON: json })).toEqual({ state: 'partial', missing: ['GOOGLE_MAPS_API_KEY'] });
  });
  it('partial: only the API key', () => {
    expect(googleConfigStatus({ GOOGLE_MAPS_API_KEY: 'k' })).toEqual({ state: 'partial', missing: ['GOOGLE_SA_JSON'] });
  });
  it('partial: old form with one var missing names it', () => {
    expect(googleConfigStatus({ GOOGLE_SA_EMAIL: 'a', GOOGLE_PROJECT_ID: 'p', GOOGLE_MAPS_API_KEY: 'k' }).missing).toEqual(['GOOGLE_SA_PRIVATE_KEY']);
  });
  it('status text', () => {
    expect(googleStatusText({ state: 'on', missing: [] })).toBe('Google: connected.');
    expect(googleStatusText({ state: 'off', missing: [] })).toBe('Google: not set up. Bus uses test routes.');
    expect(googleStatusText({ state: 'partial', missing: ['A', 'B'] })).toBe('Google: part set up. Missing: A, B.');
  });
});

describe('googleRoutingEnabled', () => {
  it('true with GOOGLE_SA_JSON in supabase mode; memory mode still needs BUS_ROUTING=google', () => {
    expect(googleRoutingEnabled({ PERSISTENCE: 'supabase', GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' })).toBe(true);
    expect(googleRoutingEnabled({ PERSISTENCE: 'memory', GOOGLE_SA_JSON: json, GOOGLE_MAPS_API_KEY: 'k' })).toBe(false);
  });
});

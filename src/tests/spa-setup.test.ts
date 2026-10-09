import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { webcrypto } from 'node:crypto';

const prelude = `const crypto = globalThis.__wc; const btoa = (s) => Buffer.from(s, 'binary').toString('base64');`;
(globalThis as any).__wc = webcrypto;

describe('setup generators', () => {
  const f = loadFns(['_genSetupCode', '_genHex32', '_genBase64Key'], prelude);
  it('setup code: 5 groups of 4 from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) expect(f._genSetupCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){4}$/);
  });
  it('hex secret is 64 hex chars', () => expect(f._genHex32()).toMatch(/^[0-9a-f]{64}$/));
  it('encryption key is base64 of 32 bytes', () => expect(Buffer.from(f._genBase64Key(), 'base64')).toHaveLength(32));
});

describe('_parseSettingsFile', () => {
  const { _parseSettingsFile } = loadFns(['_parseSettingsFile']);
  it('accepts a file made by exportSettingsFile', () => {
    const r = _parseSettingsFile(JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: { branding: { appName: 'X' } }, serviceMinAttendance: 5, termGapDays: 14 }));
    expect(r).toMatchObject({ ministryConfig: { branding: { appName: 'X' } }, serviceMinAttendance: 5, termGapDays: 14 });
  });
  it('drops busMinistry (location-specific)', () => {
    const r = _parseSettingsFile(JSON.stringify({ kind: 'ys-connection-settings', version: 1, ministryConfig: { busMinistry: { churchPlaceId: 'x' } } }));
    expect(r.ministryConfig.busMinistry).toBeUndefined();
  });
  it('returns null for anything else', () => {
    expect(_parseSettingsFile('not json')).toBeNull();
    expect(_parseSettingsFile(JSON.stringify({ kind: 'other' }))).toBeNull();
  });
});

describe('no secret ever goes to storage', () => {
  it('generator and setup functions never touch localStorage/sessionStorage', () => {
    const src = loadIndexHtml();
    for (const name of ['_genSetupCode', '_genHex32', '_genBase64Key', 'renderSetup', 'setupGenerate', 'submitCreateAdmin']) {
      const m = new RegExp(`function ${name}\\(`).exec(src);
      expect(m, name).not.toBeNull();
    }
    const block = src.slice(src.indexOf('/* ── SETUP MODULE'), src.indexOf('/* ── END SETUP MODULE'));
    expect(block).not.toMatch(/localStorage|sessionStorage/);
  });
});

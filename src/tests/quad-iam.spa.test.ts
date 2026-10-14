import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';
import { QUADS, QUAD_USERNAMES, quadLabelFor } from '../core/types/enums';

const html = loadIndexHtml();

describe('T4 "Who are you?" on quad login', () => {
  it('doLogin offers the prompt after a successful login', () => {
    const body = extractFn(html, 'doLogin');
    expect(body).toContain('_quadIamPrompt');
    expect(body.indexOf('S.user = res.user')).toBeLessThan(body.indexOf('_quadIamPrompt'));
  });
  it('the setup-admin path does not call it (admin is never a quad)', () => {
    expect(extractFn(html, 'submitCreateAdmin')).not.toContain('_quadIamPrompt');
  });
  it('doLogout keeps the "I am" pick (yap_leader_id persists across logout)', () => {
    expect(extractFn(html, 'doLogout')).not.toMatch(/removeItem\('yap_leader_id'\)|setMyLeaderId\(/);
  });
});

describe('migration 0025 (quad rename keyed on users.quad)', () => {
  const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '0025_rename_quad_accounts_by_quad.sql'), 'utf8');
  it('maps every quad to its new login and display name, keyed on users.quad not the old username', () => {
    for (const q of QUADS) expect(sql).toContain(`('${q}','${QUAD_USERNAMES[q]}','${quadLabelFor(q, true)}')`);
    expect(sql).toMatch(/u\.quad\s*=\s*m\.quad/);
    expect(sql).not.toMatch(/lower\(u\.email\)\s*=\s*m\.old/);
    expect(sql).not.toMatch(/password_hash/);
  });
});

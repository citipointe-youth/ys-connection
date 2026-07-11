import { describe, it, expect } from 'vitest';
import { parseMinistryConfig } from '../repositories/supabase/supabase.settings';
import { MINISTRY_CONFIG_DEFAULTS, MinistryConfigSchema } from '../core/ministry-config';

// Regression guard for the 2026-07-11 config-lockout incident: a legacy write
// double-encoded ministry_config as a jsonb *string* (postgres.js re-stringifies
// a value it has typed jsonb via a ::jsonb cast). Reading it then threw in
// MinistryConfigSchema.parse, which — because getSettings() runs on nearly every
// request — took down the whole app, including the Admin screen needed to fix it.
// parseMinistryConfig must NEVER throw and must recover a stringified config.

describe('parseMinistryConfig — read resilience (anti-lockout)', () => {
  it('reads a normal jsonb object config', () => {
    const cfg = MinistryConfigSchema.parse({ preset: 'simple', structure: { cohortModel: 'none' } });
    expect(parseMinistryConfig(cfg)).toEqual(cfg);
  });

  it('recovers a legacy double-encoded (stringified) config instead of throwing', () => {
    const cfg = MinistryConfigSchema.parse({ preset: 'simple' });
    // What the DB actually held during the incident: the JSON text of the config
    // stored as a jsonb string, so postgres.js returns a JS string on read.
    const doubleEncoded = JSON.stringify(cfg);
    expect(() => parseMinistryConfig(doubleEncoded)).not.toThrow();
    expect(parseMinistryConfig(doubleEncoded)).toEqual(cfg);
  });

  it('falls back to defaults for null/empty (fresh row) rather than throwing', () => {
    expect(parseMinistryConfig(null)).toEqual(MINISTRY_CONFIG_DEFAULTS);
    expect(parseMinistryConfig({})).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });

  it('falls back to defaults for garbage rather than bricking the app', () => {
    expect(parseMinistryConfig('not json at all')).toEqual(MINISTRY_CONFIG_DEFAULTS);
    expect(parseMinistryConfig(42)).toEqual(MINISTRY_CONFIG_DEFAULTS);
    expect(parseMinistryConfig({ structure: { cohortModel: 'bogus-value' } })).toEqual(MINISTRY_CONFIG_DEFAULTS);
  });
});

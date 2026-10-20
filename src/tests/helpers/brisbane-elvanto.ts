import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Brisbane's elvanto block, parsed out of migration 0040 itself (P12: shared by the site-elvanto tests,
// kept out of a .test.ts so importing it never re-registers describes).
export const ELVANTO_0040_SQL = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0040_site_elvanto.sql'), 'utf8');
export const brisbaneElvantoJson = (): string => /'(\{[\s\S]*\})'::jsonb/.exec(ELVANTO_0040_SQL)![1]!;
export const brisbaneElvanto = () => JSON.parse(brisbaneElvantoJson());

/** True on a production-like runtime. Vercel sets VERCEL and VERCEL_ENV on every deployment (preview too),
 *  and the guides tell owners not to set NODE_ENV, so security guards must not rely on NODE_ENV alone. */
export function isProductionEnv(env: Record<string, string | undefined> = process.env): boolean {
  return env['NODE_ENV'] === 'production' || !!env['VERCEL'] || !!env['VERCEL_ENV'];
}

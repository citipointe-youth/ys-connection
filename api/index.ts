export default function handler(req: any, res: any): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, build: 'esbuild-cjs-boa' }));
}

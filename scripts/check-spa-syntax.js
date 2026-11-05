// Extracts every inline <script> from public/index.html and runs node --check on it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// Line-anchored: '<script>' also appears inside an HTML comment and inside a JS string.
const re = /^<script(?![^>]*\bsrc=)[^>]*>\r?\n([\s\S]*?)^<\/script>/gim;
let m, n = 0, bad = 0;
const seen = new Set();
while ((m = re.exec(html))) {
  n++;
  const f = path.join(os.tmpdir(), `spa-check-${process.pid}-${n}.js`);
  fs.writeFileSync(f, m[1]);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`inline script #${n} FAILED:\n${r.stderr}`); }
  fs.unlinkSync(f);
  // A later top-level `function x` silently replaces an earlier one. `render` is allowed: the CA module
  // declares its own at column 0 inside its IIFE script, so it is not a global clash.
  // ponytail: indented or nested functions are unseen, on purpose; a real parser if column-0 style stops holding.
  const fn = /^(?:async\s+)?function\s*\*?\s*([\w$]+)/gm;
  let d;
  while ((d = fn.exec(m[1]))) {
    if (d[1] !== 'render' && seen.has(d[1])) { bad++; console.error(`duplicate top-level function: ${d[1]}`); }
    seen.add(d[1]);
  }
}
if (bad) process.exit(1);
console.log(`ok: ${n} inline script(s) parse cleanly`);

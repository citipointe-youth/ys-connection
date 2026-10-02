// Extracts every inline <script> from public/index.html and runs node --check on it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
// Line-anchored: '<script>' also appears inside an HTML comment and inside a JS string.
const re = /^<script(?![^>]*\bsrc=)[^>]*>\r?\n([\s\S]*?)^<\/script>/gim;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  n++;
  const f = path.join(os.tmpdir(), `spa-check-${process.pid}-${n}.js`);
  fs.writeFileSync(f, m[1]);
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`inline script #${n} FAILED:\n${r.stderr}`); }
  fs.unlinkSync(f);
}
if (bad) process.exit(1);
console.log(`ok: ${n} inline script(s) parse cleanly`);

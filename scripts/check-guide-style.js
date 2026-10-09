#!/usr/bin/env node
// Mechanical ASD-STE100 check for the guides (spec §6.3). Exit 1 on any finding.
// Ignores fenced code blocks, inline `code`, **bold** UI names, [Screenshot: …] lines and "Technical:" lines.
const fs = require('fs');
const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['docs/DEPLOYING.md', 'docs/GOOGLE-SETUP.md', 'scripts/google-setup.sh'];
const BANNED = ['simply', 'just', 'easily', 'etc', 'should', 'may', 'click', 'press', 'tap', 'hit', 'enter', 'choose', 'pick'];
// e.g. / i.e. end in a dot, so they need their own alternative (no trailing \b after a dot).
const banned = new RegExp(String.raw`\b(${BANNED.join('|')})\b|\b(e\.g\.|i\.e\.)`, 'i');
let problems = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let fence = false;
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; return; }
    if (fence || /Technical:|\[Screenshot:/.test(raw)) return;
    let text = raw.replace(/`[^`]*`/g, '').replace(/\*\*[^*]+\*\*/g, 'X').replace(/\]\([^)]*\)/g, ']');
    if (f.endsWith('.sh')) { const m = /(?:say|stop)\s+"([^"]*)"/.exec(raw); if (!m) return; text = m[1]; }
    const b = banned.exec(text);
    if (b) { problems++; console.log(`${f}:${i + 1}: banned word "${b[1] || b[2]}"`); }
    if (/^\s*\d+\.\s/.test(raw)) {
      for (const s of text.replace(/^\s*\d+\.\s/, '').split(/(?<=[.!?])\s+/)) {
        const words = s.trim().split(/\s+/).filter(Boolean).length;
        if (words > 20) { problems++; console.log(`${f}:${i + 1}: step sentence has ${words} words (max 20)`); }
      }
    }
  });
}
console.log(problems ? `${problems} problem(s).` : 'Guide style: OK');
process.exit(problems ? 1 : 0);

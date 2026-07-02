# Help Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small, role-budgeted set of help tooltips ("?" bubbles) to `public/index.html`, ported from the Camp Platform sister app's proven `helpTip()` pattern, so leaders get plain-language explanations of the app's least-obvious behaviour without cluttering the UI.

**Architecture:** CMS is a TS/Express backend (`src/`) + a single-file SPA (`public/index.html`, one `<script>` block, no build step). This is a pure SPA content/markup change — no backend, schema, or route changes. 11 `helpTip(...)` calls are inserted at specific markup locations (identified by exact line/anchor below); one shared CSS block and three shared JS functions (`helpTip`, `_toggleTip`, `_clampTip`) are ported in first.

**Tech Stack:** Vanilla JS SPA, no bundler — verify each change with `node --check` on the extracted `<script>` body (no dedicated UI test harness for this file, matching this repo's established convention).

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-07-02-help-tooltips-design.md` (already committed) — follow its placement plan exactly.
- Use CMS's own tokens only for new CSS: `var(--accent)` (`#1a1af2`), `var(--navy)` (`#0a0a2e`), `var(--chip)` (`#ececff`) — never camp's violet/navy palette.
- Tooltip copy: short (1-2 sentences), plain language, no jargon, no apostrophes/contractions (keeps the JS string literals simple — every `helpTip('...')` call uses single-quoted text with no embedded quote characters).
- Do not start a dev server or drive a browser (no browser test harness available in this environment for this SPA). Verify with `node --check` after every task, and `npm run typecheck` + `npm run test` at the end (backend is untouched — both must stay green).
- Bump `public/sw.js` `CACHE` from `cms-v9` to `cms-v10` in the final task (HTML changed — verify the current value first with `grep -n "const CACHE" public/sw.js` in case it has moved since this plan was written).
- Update `CHANGELOG.txt` with a new dated section as part of the final task.
- Deploy = `git push` to `master` (auto-deploys to https://connection-made-simple.vercel.app). Do not push until all tasks are committed and the user has confirmed.

---

### Task 1: Port the tooltip CSS + JS infrastructure

**Files:**
- Modify: `public/index.html:381` (CSS — insert before the `CA MODULE CSS START` comment)
- Modify: `public/index.html:551` (JS — insert after the `esc()` function, before `go()`)

**Interfaces:**
- Produces: `helpTip(text, opts)` → returns an HTML string for a `.htip` button (used by all later tasks). `opts.left` (boolean) right-anchors the popover for icons ending a heading row.
- Produces: `_toggleTip(e, btn)`, `_clampTip(btn)` — internal, wired via inline `onclick` in the markup `helpTip()` returns; not called directly by other tasks.
- Consumes: the existing global `esc(s)` (`public/index.html:547`) for XSS-safe interpolation.

- [ ] **Step 1: Insert the CSS block**

Find this exact block (`public/index.html:379-382`):
```css
/* ── TWO-LINE NAV LABEL ── */
.ni-lbl{display:flex;flex-direction:column;align-items:center;line-height:1.15}

/* ── CA MODULE CSS START ── */
```

Replace with:
```css
/* ── TWO-LINE NAV LABEL ── */
.ni-lbl{display:flex;flex-direction:column;align-items:center;line-height:1.15}

/* ── Reusable help tooltip (?) — hover on desktop, tap on mobile. Ported from
   the Camp Platform sister app. Use helpTip('plain text') in any markup. ── */
.htip{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--accent);background:var(--chip);color:var(--accent);font-size:11px;font-weight:800;line-height:1;cursor:pointer;position:relative;padding:0;font-family:inherit;vertical-align:middle;flex:0 0 auto}
.htip-pop{position:absolute;z-index:200;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:max-content;max-width:240px;background:var(--navy);color:#fff;border-radius:10px;padding:9px 11px;font-size:.74rem;line-height:1.45;font-weight:500;text-align:left;box-shadow:0 10px 28px rgba(10,10,46,.32);opacity:0;visibility:hidden;transition:opacity .12s;white-space:normal}
.htip-pop::before{content:"";position:absolute;bottom:100%;left:50%;transform:translateX(-50%);border:6px solid transparent;border-bottom-color:var(--navy)}
.htip:hover .htip-pop,.htip.open .htip-pop{opacity:1;visibility:visible}
.htip.tip-left .htip-pop{left:auto;right:0;transform:none}
.htip.tip-left .htip-pop::before{left:auto;right:6px;transform:none}

/* ── CA MODULE CSS START ── */
```

- [ ] **Step 2: Insert the JS functions**

Find this exact block (`public/index.html:547-552`):
```js
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function go(page) { S.page = page; render(); }
```

Replace with:
```js
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// helpTip(text[,opts]) — small "?" bubble explaining a feature in plain language.
// Shows on hover (desktop) and tap (mobile). opts.left anchors the bubble to the
// right edge for icons that end a heading row. Ported from the Camp Platform app.
function helpTip(text, opts) {
  const o = opts || {};
  return `<button type="button" class="htip${o.left ? ' tip-left' : ''}" aria-label="Help: ${esc(text)}" onclick="_toggleTip(event,this)">?<span class="htip-pop">${esc(text)}</span></button>`;
}
function _toggleTip(e, btn) {
  e.stopPropagation();
  const open = btn.classList.contains('open');
  document.querySelectorAll('.htip.open').forEach(t => t.classList.remove('open'));
  if (!open) { btn.classList.add('open'); _clampTip(btn); }
}
// Keeps the bubble fully on-screen regardless of where the "?" sits: resets to the
// CSS-default position, measures, then nudges horizontally so neither edge runs
// past the viewport (8px margin). Runs on tap and via a delegated hover listener.
function _clampTip(btn) {
  const pop = btn.querySelector('.htip-pop');
  if (!pop) return;
  const left = btn.classList.contains('tip-left');
  pop.style.transform = left ? 'none' : 'translateX(-50%)';
  const r = pop.getBoundingClientRect(), m = 8, vw = document.documentElement.clientWidth;
  let shift = 0;
  if (r.right > vw - m) shift = (vw - m) - r.right;
  if (r.left + shift < m) shift = m - (r.left + shift);
  if (shift) pop.style.transform = left ? `translateX(${shift}px)` : `translateX(calc(-50% + ${shift}px))`;
}
document.addEventListener('click', e => { if (!e.target.closest('.htip')) document.querySelectorAll('.htip.open').forEach(t => t.classList.remove('open')); });
document.addEventListener('mouseover', e => { const b = e.target.closest && e.target.closest('.htip'); if (b) _clampTip(b); });
function go(page) { S.page = page; render(); }
```

- [ ] **Step 3: Verify with `node --check`**

Reconfirm the `<script>` bounds first (they may have shifted from this plan's line 452/5426 baseline):
```bash
grep -n "^<script>$\|^</script>$" public/index.html
```
Then extract and check (adjust the range to match):
```bash
sed -n '452,5432p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: port helpTip() tooltip infrastructure from Camp Platform"
```

---

### Task 2: Standard-interface tooltips (grade / quad / director shared screens) — 3 total

**Files:**
- Modify: `public/index.html` — `renderAtRisk` (~line 2735), `renderConnectView` (~line 1961), `_renderHomeInner` (~lines 1341 and 1357)

**Interfaces:**
- Consumes: `helpTip(text, opts)` from Task 1.

- [ ] **Step 1: At-Risk screen — status legend**

Find (`renderAtRisk`, ~`public/index.html:2735`):
```js
        <div><div class="ph-title" style="display:flex;align-items:center;gap:7px">${icN('alert')} At Risk</div><div class="ph-sub">${flagged} need attention${sections.rising.length?` · ${sections.rising.length} rising`:''}</div></div>
```

Replace with:
```js
        <div><div class="ph-title" style="display:flex;align-items:center;gap:7px">${icN('alert')} At Risk ${helpTip('Stopped means no attendance in either stream this term. Declining or Mixed means a stream rate dropped 20+ points vs last term - calculated automatically, no manual thresholds.')}</div><div class="ph-sub">${flagged} need attention${sections.rising.length?` · ${sections.rising.length} rising`:''}</div></div>
```

- [ ] **Step 2: Leaders & Connect screen — search/connect scoping**

Find (`renderConnectView`, ~`public/index.html:1961`):
```js
          <div class="ph-title">Leaders &amp; Connect</div>
```

Replace with:
```js
          <div class="ph-title">Leaders &amp; Connect ${helpTip('Search and connect are scoped to your grade and gender. You can add students from other grades, but only ones matching your gender.')}</div>
```

- [ ] **Step 3: Home — Connection by Grade (both branches)**

Find, twice (`_renderHomeInner`, ~`public/index.html:1341` and `~1357` — both lines are byte-identical, use `replace_all`):
```js
          body += '<div class="sh">Connection by Grade</div><div class="card" style="padding:12px">';
```

Replace both with:
```js
          body += '<div class="sh">Connection by Grade ' + helpTip('Only counts students who attended a service or lifegroup this term or last. Students who have never attended are not counted as unconnected.') + '</div><div class="card" style="padding:12px">';
```

- [ ] **Step 4: Verify with `node --check`**

```bash
sed -n '452,5432p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output. (Reconfirm the line range per Task 1 Step 3 if it shifted.)

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add help tooltips to At-Risk, Leaders & Connect, and Home"
```

---

### Task 3: Connection Audit tooltips (director + admin) — 4 total

**Files:**
- Modify: `public/index.html` — `scopeBar` (~line 4659), `rFunnel` (~line 4780), `rGroups` (~line 4831), `plist` (~line 4885), all inside the `CA` module IIFE.

**Interfaces:**
- Consumes: the global `helpTip(text, opts)` from Task 1 — the `CA` module is an IIFE (`const CA=(()=>{...})()`) but JS closures see outer/global scope, so no import or duplication is needed. `CA`'s own local `esc()` (module-scoped, shadows the global one) is untouched and irrelevant here since `helpTip` internally uses the *global* `esc` from its own lexical scope.

- [ ] **Step 1: CA scope bar — Year/Period switcher**

Find (`scopeBar`, ~`public/index.html:4658-4661`):
```js
  return '<div class="ca-scope">'
    +'<div class="ca-scope-row"><span class="ca-scope-lb">Year</span><div class="ca-scope-ctl">'+yearCtl+'</div></div>'
    +'<div class="ca-scope-row"><span class="ca-scope-lb">Period</span><div class="ca-scope-ctl">'+termCtl+'</div></div>'
    +'</div>';
```

Replace with:
```js
  return '<div class="ca-scope">'
    +'<div class="ca-scope-row"><span class="ca-scope-lb">Year '+helpTip('This is a frozen snapshot from your last year-to-date upload, not live data. Re-upload in the Data tab to refresh it.')+'</span><div class="ca-scope-ctl">'+yearCtl+'</div></div>'
    +'<div class="ca-scope-row"><span class="ca-scope-lb">Period</span><div class="ca-scope-ctl">'+termCtl+'</div></div>'
    +'</div>';
```

- [ ] **Step 2: Funnel — stage definitions**

Find (`rFunnel`, ~`public/index.html:4780`):
```js
  b+='<div class="card"><div class="ca-ct">This term&#39;s conversion</div><div style="font-size:.62rem;color:var(--ca-muted);margin-bottom:10px">'+R[0].lb+' → '+R[4].lb+'</div>'+f+'</div>';
```

Replace with:
```js
  b+='<div class="card"><div class="ca-ct">This term&#39;s conversion '+helpTip('Stages run First contact, Friday, Regular, Lifegroup, then Student team. Each bar shows how many people reached that stage this term.')+'</div><div style="font-size:.62rem;color:var(--ca-muted);margin-bottom:10px">'+R[0].lb+' → '+R[4].lb+'</div>'+f+'</div>';
```

- [ ] **Step 3: Lifegroup Health — average-denominator explanation**

Find (`rGroups`, ~`public/index.html:4829-4834`):
```js
  let b=tabs('ca-groups');
  // Quad filter buttons.
  b+='<div class="ca-fch">'
    +'<span class="chip '+(LGQ===''?'c-accent':'c-neutral')+'" style="cursor:pointer" onclick="CA.lgfilter(\'\')">All</span>'
    +Object.keys(QLBL).map(q=>'<span class="chip '+(LGQ===q?'c-accent':'c-neutral')+'" style="cursor:pointer" onclick="CA.lgfilter(\''+q+'\')">'+(QLBL[q]||q)+'</span>').join('')
    +'</div>';
```

Replace with:
```js
  let b=tabs('ca-groups');
  b+='<div class="ca-ct" style="margin-bottom:6px">Lifegroup Health '+helpTip('A named lifegroup average divides by the weeks that group actually ran. Grade, quad and overall averages divide by valid services in the term instead, so they are not directly comparable.')+'</div>';
  // Quad filter buttons.
  b+='<div class="ca-fch">'
    +'<span class="chip '+(LGQ===''?'c-accent':'c-neutral')+'" style="cursor:pointer" onclick="CA.lgfilter(\'\')">All</span>'
    +Object.keys(QLBL).map(q=>'<span class="chip '+(LGQ===q?'c-accent':'c-neutral')+'" style="cursor:pointer" onclick="CA.lgfilter(\''+q+'\')">'+(QLBL[q]||q)+'</span>').join('')
    +'</div>';
```

- [ ] **Step 4: People — export-by-quad button**

Find (`plist`, ~`public/index.html:4885`):
```js
  b+='<button class="btn btn-secondary btn-full" style="margin-top:8px" onclick="CA.exportMenu()">Export follow-up CSV — by quad</button>';
```

Replace with:
```js
  b+='<div style="display:flex;align-items:center;gap:6px;margin-top:8px"><button class="btn btn-secondary" style="flex:1" onclick="CA.exportMenu()">Export follow-up CSV — by quad</button>'+helpTip('Downloads a CSV of people worth a follow-up in one quad: name, phone, reason (e.g. declining attendance) and score.',{left:true})+'</div>';
```

- [ ] **Step 5: Verify with `node --check`**

```bash
sed -n '452,5432p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output. (Reconfirm the line range per Task 1 Step 3 if it shifted.)

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add help tooltips to the Connection Audit feature"
```

---

### Task 4: Admin tooltips (Admin Settings + Import) — 4 total

**Files:**
- Modify: `public/index.html` — `renderAdminView` settings/data/accounts tabs (~lines 4018, 4022), `renderImport` (~line 3475), `showAddUser` (~line 4148)

**Interfaces:**
- Consumes: `helpTip(text, opts)` from Task 1.

- [ ] **Step 1: Destructive Actions — Reset vs Clear Service/Group Data**

Find (`renderAdminView`, ~`public/index.html:4021-4022`):
```js
      <div class="destructive-section">
        <div class="destructive-header">Destructive Actions</div>
```

Replace with:
```js
      <div class="destructive-section">
        <div class="destructive-header">Destructive Actions ${helpTip('Clear Service/Group Data only deletes attendance - students, leaders and connections stay. Full Reset also deletes students, leaders and connections (accounts are always kept).')}</div>
```

- [ ] **Step 2: Save Defaults**

Find (`renderAdminView`, ~`public/index.html:4017-4020`):
```js
      <div>
        <button class="btn btn-secondary btn-full" onclick="if(confirm('Save current users and leaders as year defaults?'))adminAction('/admin/save-defaults','✓ Defaults saved')">Save Defaults</button>
        <div class="help-text" style="margin-top:4px">Snapshots accounts + leaders as baseline for next year</div>
      </div>
```

Replace with:
```js
      <div>
        <button class="btn btn-secondary btn-full" onclick="if(confirm('Save current users and leaders as year defaults?'))adminAction('/admin/save-defaults','✓ Defaults saved')">Save Defaults</button>
        <div class="help-text" style="margin-top:4px;display:flex;align-items:center;gap:5px">Snapshots accounts + leaders as baseline for next year ${helpTip('Saves a snapshot of current accounts and leaders you can refer back to later. Does not touch students, connections or attendance.')}</div>
      </div>
```

- [ ] **Step 3: Import screen — re-import recomputes both streams**

Find (`renderImport`, ~`public/index.html:3475`):
```js
      <div class="card-title" style="margin-bottom:6px">Import Attendance</div>
```

Replace with:
```js
      <div class="card-title" style="margin-bottom:6px">Import Attendance ${helpTip('Each import recalculates both service and lifegroup term stats from scratch. If you only upload one type, re-upload the other afterwards too so both stay accurate.')}</div>
```

- [ ] **Step 4: Add Account modal — grade login gender-suffix convention**

Find (`showAddUser`, ~`public/index.html:4148`):
```js
    <div class="fg"><label class="fl">Username</label><input class="fi" id="u-email" type="text" placeholder="grade9"></div>
```

Replace with:
```js
    <div class="fg"><label class="fl">Username ${helpTip('For a grade login, add g or b to the end (e.g. grade9g) to scope that account to one gender. Leave it off and the account sees both genders.')}</label><input class="fi" id="u-email" type="text" placeholder="grade9"></div>
```

- [ ] **Step 5: Verify with `node --check`**

```bash
sed -n '452,5432p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: no output. (Reconfirm the line range per Task 1 Step 3 if it shifted.)

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: add help tooltips to Admin Settings and Import"
```

---

### Task 5: Cache bump, changelog, and final verification

**Files:**
- Modify: `public/sw.js` (`CACHE` constant)
- Modify: `CHANGELOG.txt` (append a new dated section)

**Interfaces:** None — this task only touches versioning/docs, no code interfaces.

- [ ] **Step 1: Bump the service worker cache name**

First confirm the current value (it may not be `cms-v9` if it moved since this plan was written):
```bash
grep -n "const CACHE" public/sw.js
```
Then edit `public/sw.js`, incrementing the version by exactly one (e.g. if it reads `const CACHE = 'cms-v9';`, change it to `const CACHE = 'cms-v10';`).

- [ ] **Step 2: Append a CHANGELOG.txt entry**

Append to the end of `CHANGELOG.txt` (match the file's existing `-----` section-header style; use today's actual date):
```
-------------------------------------------------------------------------------
HELP TOOLTIPS  (2026-07-02)
-------------------------------------------------------------------------------
- Ported the Camp Platform sister app's helpTip() "?" bubble pattern (hover on
  desktop, tap on mobile, auto-clamped so it never runs off either screen edge)
- Added 11 tooltips across three role-scoped budgets: At-Risk, Leaders &
  Connect, and Home (grade/quad/director shared screens); the Connection Audit
  hub, Funnel, Lifegroup Health, and People export (director/admin); Admin
  Settings destructive actions, Save Defaults, Import, and Add Account
  (admin/director)
- Bumped public/sw.js CACHE to force eviction of the previous cached HTML shell
```

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm run test
grep -n "const CACHE" public/sw.js
sed -n '452,5432p' public/index.html > /tmp/cms-spa-check.js
node --check /tmp/cms-spa-check.js
```
Expected: `typecheck` clean, all tests pass (backend is untouched by this change), the `CACHE` line shows the bumped version, `node --check` produces no output.

- [ ] **Step 4: Commit**

```bash
git add public/sw.js CHANGELOG.txt
git commit -m "chore: bump SW cache and changelog for help tooltips"
```

- [ ] **Step 5: Report placements for the owner to eyeball on-device**

No dev server / browser session in this environment for this SPA (per repo convention) — list all 11 tooltip locations (screen + role) for the user to spot-check live after deploy, especially near screen edges on a phone (Leaders & Connect title row, the Add Account modal's Username field, and the CA scope bar are the ones closest to an edge).

- [ ] **Step 6: Push to deploy (only after explicit go-ahead for this push)**

```bash
git push
```
`master` is linked to Vercel and auto-deploys — this is the live production push the owner asked for. Confirm all 5 tasks above are committed and `git status` is clean before pushing.

# Connection Audit SPA Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the real SPA (`youth-allocation-platform/public/index.html`) back in sync with the canonical demo (`youth app demo/allocation-platform.html`) by porting the Connection Audit module — the only drift since the 2026-06-10 alignment.

**Architecture:** Same module contract as the demo: one delimited CSS block + one delimited `CA` IIFE script block + a handful of one-line hooks tagged `/*CA-HOOK*/`, all inside `public/index.html`. The difference is the data layer: instead of reading the demo's in-memory `students`, the SPA module has an **async adapter** (`CA.load()`) that fetches `GET /students`, `GET /trends`, `GET /settings` once per audit entry and normalises field names to the demo's shape, so the model/screen code stays nearly identical. The backend is **not modified**.

**Tech Stack:** Vanilla JS in `public/index.html` (served by the Express app, `npm run dev` → http://localhost:4300). Verification: `node --check` on the extracted script, a fetch-stubbed headless harness, `npm run typecheck`, `npm run test` (backend untouched — must stay green), removal test. Git repo — commit per task with `git -c core.autocrlf=true`.

**References:** Demo spec `youth app demo/docs/superpowers/specs/2026-06-11-connection-audit-extension-design.md`; demo plan (full feature description) `youth app demo/docs/superpowers/plans/2026-06-11-connection-audit-extension.md`; demo source of truth `youth app demo/allocation-platform.html` (CA module between `/* ── CA MODULE START ── */ … END` markers, CSS between `/* ── CA MODULE CSS START ── */ … END`).

---

## Read this first — what differs from the demo port

**The drift being closed:** the demo gained the full Connection Audit on 2026-06-11 (hub + Overview/Funnel/Lifegroups/People/Data/Deck, per-quad funnels, group trend percentages + filters, Group highlights, Minto executive brief, currency banner). Everything else in the SPA was aligned 2026-06-10 and is untouched by this plan.

**Approved degradations** (the established "approximate with real aggregates" doctrine from `CLAUDE.md`; the backend has no per-student per-session API):

| Demo behaviour | SPA behaviour |
|---|---|
| Personal trend from `hist` (last-5 vs first-5 Fridays) | Rate-based: current `sA/sT` vs previous `psA/psT` for students with `psT>0` (±5pp bands); others `stable` |
| Friday pips on People rows | Text `N/T Fridays` + a small `%` bar |
| "First Friday" journey event | Dropped (no per-session per-student data) |
| Deck sparkline + Active-youth trend from `hist` counts | From `GET /trends` ministry `sessions[]` (`totalAttended`, outliers already flagged by the server — strictly better than the demo) |
| 12 named lifegroups via `lifegroupStats()` | 12 **cohort pseudo-groups** (grade × gender, members = students with `grpTotal>0`), named "Yr 7 Girls", … (no `GET /lifegroups` route exists) |
| `settings.regN/regD` | `settings.regRateNumerator/regRateDenominator` (from `GET /settings`) |
| Seed/upload store under `ca_audit_v1` | Identical — client-side localStorage. **Non-goal:** backend endpoints for connect/decision/team (future work; would need new entities + routes) |
| Full Reset hook in `clearPersistedData()` | Hook in `adminAction()` success path when `path==='/admin/reset'` |

**SPA symbols the module uses (verified):** `S={user,page,settings}` (line ~345), `go(page)` (~346), **async** `render()` dispatch (~544), `shell(body)` with `<h1>Youth Allocation</h1>` and **no back button** (~494), `setApp` (~359), `modal(html)` / `closeModal()` (~352/358), `toast` (~347), `API.get/post` helper, `splitCSVLine` (~2212), `navItems()` (~447, same `slice(0,4)`/`slice(4)` convention), `adminAction(path,msg)` (~2461), quad chip class `quad-g79` etc (~414).

**Class & token mapping** (the SPA's CSS vocabulary differs from the demo's — every transcribed screen uses the right column):

| Demo | SPA |
|---|---|
| `.sg .sc .sv .sl` | `.stat-grid .stat .stat-v .stat-l` |
| `.sh_` | `.sh` |
| `.bp .bs .bsm .bf` | `.btn-primary .btn-secondary .btn-sm .btn-full` |
| `.lb .lt .ls .lr` | `.li-body .li-title .li-sub .li-right` |
| chips `ca cs cw cd cn` | `c-accent c-success` **`ca-cw`(new)** `c-danger c-neutral` |
| quad chips `qg79…` | `quad-g79…` |
| `.av f/m/n` | **`.ca-av f/m/n`** (new — SPA has no avatar class) |
| `IC[..]`/`ic()` SVG icons | emoji (`🔗 📊 📈 👥 🧑‍🤝‍🧑 📥 📑 ✓`) |
| `closeM()` | `closeModal()` |
| `fmtDM` | module-local `fmtD(iso)` (zero dependency on core helpers) |
| CSS `var(--navy)` etc | **`var(--ca-navy)`** etc — the CA CSS block defines its own `--ca-*` tokens; the SPA's token set (`--paper-card --ink-mid --accent…`) is different, so the module never references host tokens |

**Global transformation rule for anything copied from the demo module:** replace every `var(--X)` with `var(--ca-X)`; the token set is defined in Task 2. Hex colours stay as-is.

**Syntax check (run after every edit):**

```powershell
$h=Get-Content 'C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\youth-allocation-platform\public\index.html' -Raw
$s=[regex]::Match($h,'(?s)<script>(.*)</script>').Groups[1].Value
Set-Content -Encoding utf8 "$env:TEMP\spa.js" $s
node --check "$env:TEMP\spa.js"
```

> If the file has more than one `<script>` block, this greedy regex spans them all — that is fine for `node --check` only if the content between blocks is empty; verify with `(Select-String '<script>' file).Count`. As of 2026-06-11 the SPA has a single block.

**Harness run:** `node "C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\_ca-dev\ca-spa-harness.mjs"` (built in Task 1).

---

### Task 1: Branch, fixtures, fetch-stubbed harness

**Files:**
- Create: `Project 4 - Youth Apps\_ca-dev\ca-spa-harness.mjs`

- [ ] **Step 1: Branch**

```powershell
Set-Location 'C:\Users\thoma\Claude Programs\Project 4 - Youth Apps\youth-allocation-platform'
git checkout -b connection-audit-sync
```

- [ ] **Step 2: Write the harness**

Same DOM-stub pattern as `_ca-dev/ca-harness.mjs` (the demo harness — read it first), with three differences: (a) a **fetch stub** serving fixtures for the API routes the SPA calls, (b) async navigation (`render()` is async — await a tick after `go`), (c) SPA-specific markers. Create `_ca-dev\ca-spa-harness.mjs`:

```js
// Headless harness for youth-allocation-platform/public/index.html + CA module.
// Usage: node ca-spa-harness.mjs [path-to-html] [--core-only]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter(a => a !== '--core-only');
const CORE_ONLY = process.argv.includes('--core-only');
const FILE = args[0] || path.join(here, '..', 'youth-allocation-platform', 'public', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('NO <script> FOUND'); process.exit(1); }

// ---- fixtures ----
const FIRST = ['Mia','Jack','Ava','Noah','Ella','Liam','Zoe','Ethan','Ruby','Lucas','Isla','Mason'];
const LAST  = ['Thompson','Wilson','Chen','Davis','Brown','Taylor','White','Martin','Lee','Walker'];
const students = [];
let idn = 0;
for (const gender of ['female','male']) for (let grade = 7; grade <= 12; grade++) {
  for (let i = 0; i < 4; i++) {
    const n = idn++;
    const sT = 10, sA = [9,7,4,0][i], gT = i < 3 ? 6 : 0, gA = [5,3,1,0][i];
    const flagged = i >= 2; // mirrors the platform: prev-term data only for flagged students
    students.push({
      id: 's-' + n, firstName: FIRST[n % FIRST.length], lastName: LAST[n % LAST.length] + n,
      gender, grade, quad: (grade <= 9 ? (gender === 'female' ? 'g79' : 'b79') : (gender === 'female' ? 'g1012' : 'b1012')),
      mobile: '0400000' + String(100 + n), parentPhone: null, dateOfBirth: null,
      svcAttended: sA, svcTotal: sT, grpAttended: gA, grpTotal: gT, grpMetWeeks: gT,
      prevSvcAttended: flagged ? 7 : 0, prevSvcTotal: flagged ? 10 : 0,
      prevGrpAttended: flagged ? 4 : 0, prevGrpTotal: flagged ? 6 : 0,
      atRiskStatus: null, dataSource: 'fixture', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    });
  }
}
const sessions = [...Array(10)].map((_, i) => ({
  sessionId: 'ss-' + i, sessionDate: '2026-02-0' + ((i % 9) + 1), sessionName: 'Friday ' + (i + 1),
  totalAttended: 60 + i * 2, totalPresent: 96, isOutlier: false,
}));
const FIX = {
  '/settings': { ministryName: 'Youth Ministry', regRateNumerator: 3, regRateDenominator: 4, riskRateNumerator: 1, riskRateDenominator: 2, serviceName: 'Fridays', lifegroupName: 'Lifegroup', allocationLockDate: null },
  '/students': students,
  '/trends': { ministry: { sessions, averageAttendance: 68, trend: 'up' }, byQuad: [], byGrade: [], lifegroups: {} },
  '/overview': { ministryTotal: students.length, allocatedTotal: 10, unallocatedTotal: 5, atRiskTotal: 4, byQuad: [] },
  '/import/history': [], '/leaders': [], '/allocations': [], '/at-risk': [],
};
function fetchStub(u, opts) {
  const p = String(u).replace(/^[a-z]+:\/\/[^/]+/, '').split('?')[0].replace(/^\/api/, '');
  const body = Object.prototype.hasOwnProperty.call(FIX, p) ? FIX[p]
    : p === '/auth/login' ? { token: 't', user: { id: 'u-dir', name: 'Director', role: 'director' } } : {};
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

// ---- DOM stubs (identical pattern to ca-harness.mjs) ----
function elStub() {
  const store = { innerHTML: '', value: '', textContent: '' };
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k === 'innerHTML' || k === 'value' || k === 'textContent') return store[k];
      if (k === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains: () => false };
      if (k === 'querySelectorAll') return () => [];
      if (k === 'querySelector') return () => elStub();
      if (k === 'dataset') return {};
      if (k === 'children') return [];
      if (k === 'matches') return () => false;
      if (typeof k === 'symbol') return undefined;
      if (['addEventListener','removeEventListener','appendChild','removeChild','remove','click','focus','blur','setAttribute','insertBefore','closest','scrollTo'].includes(k)) return () => p;
      return p;
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return p; },
  });
  return p;
}
const byId = new Map();
const documentStub = {
  getElementById(id) { if (!byId.has(id)) byId.set(id, elStub()); return byId.get(id); },
  createElement: () => elStub(), querySelector: () => elStub(), querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, body: elStub(), documentElement: elStub(),
};
const mkStorage = () => ({ _m: new Map(),
  getItem(k){ return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k,v){ this._m.set(k, String(v)); },
  removeItem(k){ this._m.delete(k); }, clear(){ this._m.clear(); } });
const localStorageStub = mkStorage(), sessionStorageStub = mkStorage();
const windowStub = {
  matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  open: () => ({ document: { write(){}, close(){} } }),
  addEventListener() {}, location: { href: '', origin: 'http://x' },
};

const probe = ';globalThis.__T={get S(){return S},go,render,win:windowStub};';
const fn = new Function('window','windowStub','document','localStorage','sessionStorage','navigator','fetch','URL','Blob','FileReader','location','setTimeout','clearTimeout','confirm','alert', m[1] + probe);
fn(windowStub, windowStub, documentStub, localStorageStub, sessionStorageStub, { userAgent: 'harness' }, fetchStub,
   { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
   function Blob(parts){ globalThis.__lastBlob = (parts || []).join(''); },
   function FileReader(){ this.readAsText = () => {}; },
   { href: '' }, (f) => { if (typeof f === 'function') f(); return 0; }, () => {}, () => true, () => {});

const tick = () => new Promise(r => setImmediate(r));
const T = globalThis.__T;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + msg); } };
const app = () => documentStub.getElementById('app').innerHTML;
const nav = async p => { T.go(p); for (let i = 0; i < 6; i++) await tick(); };

(async () => {
  T.S.user = { id: 'u-dir', name: 'Director', role: 'director' };
  T.S.settings = FIX['/settings'];
  await nav('home');
  ok(app().includes('Quick Actions'), 'home renders Quick Actions');

  if (!CORE_ONLY) {
    const CA = T.win.CA;
    ok(!!CA, 'window.CA defined');
    if (CA) {
      ok(app().includes('Connection Audit'), 'director home shows Connection Audit tile');
      const MARK = {
        'ca-hub': 'Build Presentation', 'ca-overview': 'Integration ladder',
        'ca-funnel': 'Biggest leak', 'ca-groups': 'Visits / active',
        'ca-people': 'ca-plist', 'ca-data': 'keep these current',
        'ca-deck': 'Executive presentation',
      };
      for (const p of Object.keys(MARK)) {
        await nav(p);
        ok(T.S.page === p, p + ' keeps S.page');
        ok(app().includes(MARK[p]), p + ' shows "' + MARK[p] + '"');
        ok(app().includes('<h1>Connection Audit</h1>'), p + ' header retitled');
      }
      const md = await CA.model();
      ok(md.rungs.length === 5, 'funnel has 5 rungs');
      ok(md.rungs.every((r, i, a) => i === 0 || r.v <= a[i - 1].v), 'funnel monotonic');
      ok(md.people.filter(p => p.caOnly).length >= 20, 'audit-only people from seed');
      ok(md.groups.length === 12, '12 cohort groups (' + md.groups.length + ')');
      ok(md.groups.every(g => typeof g.trendPct === 'number'), 'group trendPct numeric');
      ok(md.people.every(p => p.score >= 0 && p.score <= 100), 'scores in 0-100');
      ok(CA.stale() === true, 'seed counts as stale');
      ok(localStorageStub._m.has('ca_audit_v1'), 'store persisted');
      await nav('ca-overview'); ok(app().includes('ca-warnb'), 'banner on Overview');
      ok(app().includes('Group highlights'), 'overview has Group highlights');
      await nav('ca-data'); ok(!app().includes('ca-warnb'), 'no banner on Data');
      ok(app().includes('Executive brief'), 'data has brief export');
      await nav('ca-funnel');
      ok(app().includes('View funnel per quad'), 'funnel quad-expand button');
      CA.fquad(); for (let i = 0; i < 6; i++) await tick();
      ok(app().includes('Girls Yr 7–9'), 'quad funnels expand'); CA.fquad();
      await nav('ca-deck'); ok(app().includes('Back to Overview'), 'deck back button');
      globalThis.__lastBlob = ''; await CA.buildDeck();
      ok((globalThis.__lastBlob.match(/<section class="slide/g) || []).length === 9, 'deck has 9 slides');
      ok(globalThis.__lastBlob.includes('demo seed'), 'deck currency note');
      T.S.user = { role: 'quad', quad: 'g79', name: 'Q' };
      await nav('ca-hub');
      ok(T.S.page === 'home', 'quad role redirected home');
      T.S.user = { id: 'u-dir', name: 'Director', role: 'director' };
      CA.reset();
      ok(!localStorageStub._m.has('ca_audit_v1'), 'CA.reset clears store');
    }
  }
  console.log((CORE_ONLY ? '[core-only] ' : '') + 'PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 3: Run core-only — must pass**

Run: `node "...\_ca-dev\ca-spa-harness.mjs" --core-only`
Expected: `[core-only] PASS 1 / FAIL 0`. Extend the DOM/fetch stubs (never the app) if the SPA boot throws — likely gaps: the SPA's `API` helper may call `fetch('/api/…')` or plain paths; the stub strips both.

- [ ] **Step 4: Run full — red on `window.CA defined`**

Expected: `FAIL: window.CA defined`, exit 1.

- [ ] **Step 5: Commit**

```powershell
git -c core.autocrlf=true add -A; git -c core.autocrlf=true commit -m "test: fetch-stubbed headless harness for Connection Audit SPA port"
```

(The harness lives in `_ca-dev/` outside the repo — commit will pick up only repo files; if nothing is staged, skip the commit and note the harness is untracked by design.)

---

### Task 2: CA CSS block + hooks

**Files:**
- Modify: `youth-allocation-platform\public\index.html`

- [ ] **Step 1: CSS block.** Copy the demo's CA CSS (everything between `/* ── CA MODULE CSS START ── */` and `/* ── CA MODULE CSS END ── */` in `youth app demo/allocation-platform.html`) and insert it immediately before the SPA's `</style>`. Then apply two transforms to the copied block ONLY:

1. Replace every `var(--` with `var(--ca-`.
2. Prepend this token + extras line right after the START marker:

```css
:root{--ca-navy:#12233b;--ca-blue:#2563eb;--ca-teal:#0ea5a4;--ca-amber:#f59e0b;--ca-rose:#e11d48;--ca-green:#16a34a;--ca-paper:#f4f7fc;--ca-card:#fff;--ca-ink:#1f2937;--ca-muted:#647488;--ca-line:#e8edf4;--ca-chip:#eef4ff;--ca-r:14px;--ca-rs:11px;--ca-sh:0 3px 10px rgba(18,35,59,.05);}
.ca-cw{background:#fef3c7;color:#92660b}
.ca-av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-size:.74rem;font-weight:700;flex:none}
.ca-av.f{background:#fce4f1;color:#c0257e}.ca-av.m{background:#dbe6ff;color:#2851a3}.ca-av.n{background:#fef3c7;color:#92660b}
.ca-tile{background:var(--ca-card);border:1px solid var(--ca-line);border-radius:var(--ca-r);padding:13px 8px;min-height:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:var(--ca-sh);cursor:pointer}
.ca-tile .tic{font-size:24px;margin-bottom:6px}
.ca-tile .tl{font-size:.74rem;font-weight:700;color:var(--ca-navy)}
.ca-tile .ts{font-size:.62rem;color:var(--ca-muted);margin-top:2px}
.ca-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:4px}
.ca-lgbar{height:7px;background:var(--ca-paper);border-radius:999px;overflow:hidden;margin-top:5px;max-width:90px}
.ca-lgbar i{display:block;height:100%;border-radius:999px;background:var(--ca-blue)}
```

(`.ca-tile/.ca-tiles` replace the demo's `.tile/.tiles` — the SPA has no tile classes; `.ca-lgbar` is the People-row attendance bar replacing pips.)

- [ ] **Step 2: Hook 1 — director Quick Action.** In `navItems()` the director return array (~line 481) ends with `{ id:'import', icon:'📥', label:'Import', mbl:'Import' },`. Insert after it:

```js
    { id:'ca-hub', icon:'🔗', label:'Connection Audit', mbl:'Connection Audit' }, /*CA-HOOK*/
```

- [ ] **Step 3: Hook 2 — admin Quick Action.** In the admin array, after `{ id:'admin', icon:'⚙️', label:'Admin', mbl:'Admin' },` insert the same line `/*CA-HOOK*/`.

- [ ] **Step 4: Hook 3 — router.** In async `render()` (~line 544), change:

```js
async function render() {
  if (!S.user) { renderLogin(); return; }
  const p = S.page;
```

to:

```js
async function render() {
  if (!S.user) { renderLogin(); return; }
  const p = S.page;
  if (p && p.indexOf('ca-') === 0 && window.CA) { await CA.render(p); return; } /*CA-HOOK*/
```

- [ ] **Step 5: Hook 4 — Full Reset.** Open `async function adminAction(path, msg)` (~line 2461). After the statement that fires the success toast, insert on its own line:

```js
  if (path === '/admin/reset' && window.CA) CA.reset(); /*CA-HOOK*/
```

- [ ] **Step 6: Syntax check** — exit 0. **Commit:** `git -c core.autocrlf=true commit -am "feat(ca): CSS block + 4 tagged hooks for Connection Audit"`

---

### Task 3: Module — store, seed, adapter, model

**Files:**
- Modify: `youth-allocation-platform\public\index.html`

- [ ] **Step 1: Insert the module block.** Immediately BEFORE the boot block at the end of the script (the statement `try { S.settings = await API.get('/settings'); } catch { S.settings = {}; }` lives inside it, ~line 2627 — insert before the function/IIFE that contains it):

```js
/* ── CA MODULE START ── */
// Connection Audit — ported from the canonical demo (youth app demo/allocation-platform.html).
// Same module contract: remove by deleting this block, the CA MODULE CSS block, and every /*CA-HOOK*/ line.
// Data comes from GET /students + /trends + /settings (async adapter); uploads stay in localStorage.
const CA=(()=>{
const KEY='ca_audit_v1';
let st=null,warnOff=false,mdl=null,D=null; // D = {students,trends,settings} cache
const PF={q:'',stage:'',quad:'',dec:false,cap:60};
let GF='',FQ=false;
const QLBL={g79:'Girls Yr 7–9',b79:'Boys Yr 7–9',g1012:'Girls Yr 10–12',b1012:'Boys Yr 10–12'};
const CA_NAMES=['Ava Okafor','Noah Castellanos','Isla Vandermeer','Eli Borowski','Maya Lindqvist','Levi Acheampong','Zara Kowalczyk','Finn Drummond','Lena Marchetti','Kai Stratford','Ruby Vasquez','Theo Lindgren','Nina Oyelaran','Jude Hartmann','Esme Calloway','Remy Delacroix','Sofia Andrade','Hugo Bertrand','Lola Fitzwilliam','Omar Castaneda','Iris Galloway','Felix Moreau','Tara Whitlock','Ezra Soderberg','Mila Beaumont','Arlo Kingsley'];

// ---------- utils ----------
function h32(x){let h=0;for(const c of String(x))h=(h*31+c.charCodeAt(0))>>>0;return h;}
function norm(n){return String(n||'').toLowerCase().replace(/\s+/g,' ').trim();}
function ini(n){const p=String(n).trim().split(/\s+/);return((p[0]||'?')[0]+(p[1]?p[1][0]:'')).toUpperCase();}
function fmtD(iso){if(!iso)return'—';const d=new Date(iso);return isNaN(d)?'—':d.getUTCDate()+'/'+(d.getUTCMonth()+1);}
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ---------- async adapter ----------
async function load(force){
  if(D&&!force)return D;
  const[stu,tr,se]=await Promise.all([
    API.get('/students').catch(()=>[]),
    API.get('/trends').catch(()=>null),
    API.get('/settings').catch(()=>({})),
  ]);
  D={
    students:(stu||[]).map(s=>({id:s.id,fn:s.firstName||'',ln:s.lastName||'',gender:s.gender,grade:s.grade,quad:s.quad,
      sA:s.svcAttended||0,sT:s.svcTotal||0,gA:s.grpAttended||0,gT:s.grpTotal||0,
      psA:s.prevSvcAttended||0,psT:s.prevSvcTotal||0,pgA:s.prevGrpAttended||0,pgT:s.prevGrpTotal||0,
      ph:s.mobile||'',pp:s.parentPhone||''})),
    trends:tr,settings:se||{},
  };
  return D;
}
function sessSeries(){const t=D&&D.trends&&D.trends.ministry;return((t&&t.sessions)||[]).filter(x=>!x.isOutlier).map(x=>({date:x.sessionDate,v:x.totalAttended||0}));}
function sessDates(){const ss=sessSeries();if(ss.length)return ss.map(x=>x.date);const a=[];for(let i=9;i>=0;i--)a.push(new Date(Date.now()-i*7*864e5).toISOString().slice(0,10));return a;}
function regR(){const s=D.settings||{};return(s.regRateNumerator||3)/(s.regRateDenominator||4);}

// ---------- store ----------
function save(){try{localStorage.setItem(KEY,JSON.stringify(st));}catch{}}
function restore(){
  if(st)return;
  try{const r=localStorage.getItem(KEY);if(r){const d=JSON.parse(r);if(d&&d.v===1&&d.uploads&&d.uploads.team&&d.uploads.connect&&d.uploads.decision){st=d;return;}}}catch{}
  st={v:1,uploads:seedRows()};save();
}
function reset(){try{localStorage.removeItem(KEY);}catch{}st=null;mdl=null;D=null;warnOff=false;}
function seedOn(){restore();return['team','connect','decision'].some(k=>st.uploads[k].src==='seed');}
function stale(){restore();return['team','connect','decision'].some(k=>st.uploads[k].src==='seed'||(Date.now()-Date.parse(st.uploads[k].at))>30*864e5);}

// ---------- seed (deterministic from the live roster; requires load() first) ----------
function seedRows(){
  const now=new Date().toISOString();const SD=sessDates();const roster=(D&&D.students)||[];
  const team=roster.filter(s=>(s.grade||0)>=10).sort((a,b)=>(b.sA+b.gA)-(a.sA+a.gA)||(a.id<b.id?-1:1)).slice(0,58).map(s=>({name:s.fn+' '+s.ln,date:null}));
  const connect=[];let decision=[];
  for(const s of roster){
    const h=h32(s.id);
    if(h%7===0)connect.push({name:s.fn+' '+s.ln,date:SD[h%SD.length]});
    if(s.sA>=3&&s.sA<=7&&h%13===0)decision.push({name:s.fn+' '+s.ln,date:SD[(h>>3)%SD.length]});
  }
  CA_NAMES.forEach((n,i)=>connect.push({name:n,date:SD[(i*3)%SD.length]}));
  decision=decision.slice(0,20);
  CA_NAMES.slice(0,5).forEach((n,i)=>decision.push({name:n,date:SD[(i*2+1)%SD.length]}));
  const mkU=rows=>({rows,at:now,fn:'(demo seed)',src:'seed'});
  return{team:mkU(team),connect:mkU(connect),decision:mkU(decision)};
}

// ---------- CSV parsing (reuses core splitCSVLine) ----------
function isoDate(d){
  if(!d)return null;
  let m=String(d).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];
  m=String(d).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if(m){let y=+m[3];if(y<100)y+=2000;return y+'-'+String(+m[2]).padStart(2,'0')+'-'+String(+m[1]).padStart(2,'0');}
  return null;
}
function parseRows(text){
  const lines=String(text||'').trim().split(/\r?\n/);
  if(lines.length<2)return null;
  const hd=splitCSVLine(lines[0]).map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase());
  const gi=n=>hd.indexOf(n);
  const iN=gi('name');
  const iF=Math.max(gi('first name'),gi('first_name'),gi('firstname'));
  const iL=Math.max(gi('last name'),gi('last_name'),gi('lastname'));
  const iD=Math.max(gi('date'),gi('decision date'),gi('connect date'));
  if(iN<0&&iF<0)return null;
  const out=[];
  for(const line of lines.slice(1)){
    const v=splitCSVLine(line).map(x=>x.replace(/^"|"$/g,'').trim());
    const name=iN>=0?v[iN]:((v[iF]||'')+' '+(iL>=0?(v[iL]||''):'')).trim();
    if(!name)continue;
    out.push({name,date:iD>=0?isoDate(v[iD]):null});
  }
  return out;
}

// ---------- model (SPA variant: rate-based personal trend; cohort groups) ----------
function trendOf(s){
  if(!s||!s.psT||!s.sT)return'stable';
  const d=s.sA/s.sT-s.psA/s.psT;
  return d>=0.05?'rising':d<=-0.05?'declining':'stable';
}
function scoreOf(stage,s,trend){
  if(!stage)return 0;
  const base=[0,10,30,55,75,90][stage];
  const cons=s&&s.sT>0?Math.round(10*s.sA/s.sT):0;
  const tm=trend==='rising'?5:trend==='declining'?-10:0;
  return Math.max(0,Math.min(100,base+cons+tm));
}
function model(){
  if(mdl)return mdl;restore();
  const students=D.students,rr=regR();
  const rate=(a,b)=>b>0?a/b:0;
  const marks=new Map();
  const mk=(k,nm)=>{let x=marks.get(k);if(!x){x={name:nm};marks.set(k,x);}return x;};
  for(const r of st.uploads.team.rows){const k=norm(r.name);if(!k)continue;mk(k,r.name).team=true;}
  for(const r of st.uploads.connect.rows){const k=norm(r.name);if(!k)continue;const x=mk(k,r.name);x.hasConnect=true;if(r.date&&(!x.connect||r.date<x.connect))x.connect=r.date;}
  for(const r of st.uploads.decision.rows){const k=norm(r.name);if(!k)continue;const x=mk(k,r.name);x.hasDecision=true;if(r.date&&(!x.decision||r.date>x.decision))x.decision=r.date;}
  const byName=new Set(students.map(s=>norm(s.fn+' '+s.ln)));
  const people=[];
  for(const s of students){
    const k=norm(s.fn+' '+s.ln),x=marks.get(k)||{};
    const stage=x.team?5:s.gT>0?4:(s.sT>0&&s.sA/s.sT>=rr)?3:s.sA>0?2:(x.hasConnect||x.hasDecision)?1:0;
    const trend=trendOf(s);
    people.push({id:s.id,name:s.fn+' '+s.ln,s,caOnly:false,stage,trend,score:scoreOf(stage,s,trend),connect:x.connect||null,decision:x.decision||null,conn:!!x.hasConnect,dec:!!x.hasDecision,team:!!x.team});
  }
  for(const[k,x]of marks){
    if(byName.has(k))continue;
    const stage=x.team?5:1;
    people.push({id:'cax-'+h32(k),name:x.name,s:null,caOnly:true,stage,trend:'stable',score:scoreOf(stage,null,'stable'),connect:x.connect||null,decision:x.decision||null,conn:!!x.hasConnect,dec:!!x.hasDecision,team:!!x.team});
  }
  const rungs=[[1,'First contact'],[2,'Came to Friday'],[3,'Regular'],[4,'In a lifegroup'],[5,'Student team']]
    .map(([n,lb])=>({n,lb,v:people.filter(p=>p.stage>=n).length}));
  // KPIs
  const act=students.filter(s=>s.sA>0).length;
  const inLG=students.filter(s=>s.gT>0).length;
  const ss=sessSeries();
  const avgFri=ss.length?Math.round(ss.reduce((t,x)=>t+x.v,0)/ss.length):Math.round(students.reduce((t,s)=>t+s.sA,0)/10);
  const tv=students.filter(s=>s.psT>0);
  const svcD=Math.round((rate(tv.reduce((t,s)=>t+s.sA,0),tv.reduce((t,s)=>t+s.sT,0))-rate(tv.reduce((t,s)=>t+s.psA,0),tv.reduce((t,s)=>t+s.psT,0)))*100);
  const tg=students.filter(s=>s.pgT>0);
  const grpD=Math.round((rate(tg.reduce((t,s)=>t+s.gA,0),tg.reduce((t,s)=>t+s.gT,0))-rate(tg.reduce((t,s)=>t+s.pgA,0),tg.reduce((t,s)=>t+s.pgT,0)))*100);
  let actTrend='level';
  if(ss.length>=6){
    const f3=(ss[0].v+ss[1].v+ss[2].v)/3,l3=(ss[ss.length-3].v+ss[ss.length-2].v+ss[ss.length-1].v)/3;
    actTrend=l3-f3>=5?'rising':f3-l3>=5?'declining':'level';
  }
  const decisions=people.filter(p=>p.dec).length;
  // groups = 12 grade×gender cohorts (the API exposes no named lifegroups)
  const groups=[];
  for(const gender of['female','male'])for(let gr=7;gr<=12;gr++){
    const mem=students.filter(s=>s.grade===gr&&s.gender===gender&&s.gT>0);
    const enrolled=mem.length;
    const active=mem.filter(s=>s.gA>0).length;
    const va=active?+(mem.reduce((t,s)=>t+s.gA,0)/active).toFixed(1):0;
    const breadth=enrolled?active/enrolled:0;
    const weeksRun=enrolled?Math.max(0,...mem.map(s=>s.gT)):0;
    const pv=mem.filter(s=>s.pgT>0);
    let trend='stable',trendPct=0;
    if(pv.length){
      const cur=rate(pv.reduce((t,s)=>t+s.gA,0),pv.reduce((t,s)=>t+s.gT,0));
      const prev=rate(pv.reduce((t,s)=>t+s.pgA,0),pv.reduce((t,s)=>t+s.pgT,0));
      trendPct=Math.round((cur-prev)*100);
      trend=cur-prev>=0.05?'rising':prev-cur>=0.05?'declining':'stable';
    }
    const loose=enrolled>=10&&va<3&&trend==='stable';
    groups.push({id:'co-'+gr+(gender==='female'?'f':'m'),name:'Yr '+gr+' '+(gender==='female'?'Girls':'Boys'),grade:gr,gender,mem,enrolled,active,va,breadth,weeksRun,trend,trendPct,loose});
  }
  mdl={people,rungs,groups,kpis:{act,inLG,avgFri,svcD,grpD,actTrend,decisions}};
  return mdl;
}
```

(The shell/screens/router/exports land in Tasks 4–6; for now close the IIFE with a temporary stub so the file parses:)

```js
async function render(p){
  if(!S.user||!['director','admin'].includes(S.user.role)){go('home');return;}
  await load(p==='ca-hub'||!D); // refresh on hub entry
  restore();mdl=null;
  setApp(shell('<div class="card">Connection Audit — screens land in the next commits</div>').replace('<h1>Youth Allocation</h1>','<h1>Connection Audit</h1>'));
}
return{render,reset,stale,seedOn,model:async()=>{await load();return model();},
  dismissWarn(){},fquad(){},gfilter(){},pick(){},upload(){},showPerson(){},showGroup(){},exportMenu(){},exportQuad(){},buildDeck(){},pq(){},pstage(){},pquad(){},pdec(){},pmore(){}};
})();
window.CA=CA;
/* ── CA MODULE END ── */
```

Note: the exposed `model` is an async wrapper (`await load()` first) so the harness and console can call it cold; internal screens call the sync `model()` after `render` has loaded.

- [ ] **Step 2: Syntax check** — exit 0.
- [ ] **Step 3: Harness** — newly passing: `window.CA defined`, home tile, `keeps S.page`+`header retitled` for all pages, model assertions (rungs, audit-only, 12 cohorts, trendPct, scores), `stale`, store persisted, reset. Screen markers still red.
- [ ] **Step 4: Commit** — `git -c core.autocrlf=true commit -am "feat(ca): module skeleton — async adapter, store, seed, model"`

---

### Task 4: Shell, router, hub, overview

**Files:** Modify the CA module only.

- [ ] **Step 1: Replace the temporary `render` stub and add shell + the first two screens.** Insert after `model()` (and delete the temporary `render`/return; the new return object is in Step 2):

```js
// ---------- shell ----------
function tabs(page){
  const T=[['ca-overview','Overview'],['ca-funnel','Funnel'],['ca-groups','Lifegroups'],['ca-people','People'],['ca-data','Data']];
  return '<div class="ca-tabs">'+T.map(([id,lb])=>'<span class="ca-tab'+(page===id?' on':'')+'" onclick="go(\''+id+'\')">'+lb+'</span>').join('')+'</div>';
}
function caShell(body,page){
  const back='<button class="btn btn-secondary btn-sm" style="margin-bottom:10px" onclick="go(\''+(page==='ca-hub'?'home':'ca-hub')+'\')">‹ '+(page==='ca-hub'?'Home':'Audit hub')+'</button>';
  let h=shell(back+body);
  h=h.replace('<h1>Youth Allocation</h1>','<h1>Connection Audit</h1>');
  if(stale()&&!warnOff&&page!=='ca-data'){
    const seedy=seedOn();
    h=h.replace('</main>','<div class="ca-warnb"><span class="ca-wi">⚠</span><div onclick="go(\'ca-data\')" style="cursor:pointer"><b>'+(seedy?'Demo seed in use.':'Data ageing.')+'</b> Student Team, Connect &amp; Decision data '+(seedy?'was seeded '+fmtD(st.uploads.team.at):'needs a refresh')+' — update it in the <b>Data</b> tab for currency.</div><span class="ca-wx" onclick="CA.dismissWarn()">✕</span></div></main>');
  }
  setApp(h);
}
function dismissWarn(){warnOff=true;rerender();}
function rerender(){const p=S.page;dispatch(p);}
// ---------- screens ----------
function rHub(){
  const m=model();
  const partPct=m.kpis.act?Math.round(m.kpis.inLG/m.kpis.act*100):0;
  const decl=m.groups.filter(g=>g.trend==='declining').length;
  let b='<div class="card" style="background:linear-gradient(135deg,#12233b,#1a3a6b);color:#fff;padding:15px">'
    +'<div style="font-size:.6rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;opacity:.7">This term</div>'
    +'<div style="display:flex;gap:18px;margin-top:7px">'
    +'<div><div style="font-size:1.3rem;font-weight:800">'+m.kpis.act+'</div><div style="font-size:.56rem;opacity:.75;text-transform:uppercase">Active youth</div></div>'
    +'<div><div style="font-size:1.3rem;font-weight:800">'+partPct+'%</div><div style="font-size:.56rem;opacity:.75;text-transform:uppercase">In a lifegroup</div></div>'
    +'<div><div style="font-size:1.3rem;font-weight:800">'+m.kpis.decisions+'</div><div style="font-size:.56rem;opacity:.75;text-transform:uppercase">Decisions</div></div>'
    +'</div></div>';
  const tiles=[
    ['ca-overview','📊','Overview','Term health at a glance'],
    ['ca-funnel','📈','Funnel & Conversion','Where people drop off'],
    ['ca-groups','🧑‍🤝‍🧑','Lifegroup Health',m.groups.length+' cohorts · '+decl+' declining'],
    ['ca-people','👥','People',m.people.filter(p=>p.stage>0).length+' tracked · search'],
    ['ca-data','📥','Data','2 synced · 3 uploads'+(seedOn()?' · seed':'')],
    ['ca-deck','📑','Build Presentation','Exec deck · new tab'],
  ];
  b+='<div class="ca-tiles">'+tiles.map(t=>'<div class="ca-tile" onclick="go(\''+t[0]+'\')"><span class="tic">'+t[1]+'</span><div class="tl">'+t[2]+'</div><div class="ts">'+t[3]+'</div></div>').join('')+'</div>';
  caShell(b,'ca-hub');
}
function rOverview(){
  const m=model(),k=m.kpis;
  const dl=v=>v>0?'<div class="ca-dlt up">▲ +'+v+'pp vs prev term</div>':v<0?'<div class="ca-dlt dn">▼ '+v+'pp vs prev term</div>':'<div class="ca-dlt fl">− level vs prev term</div>';
  const at=k.actTrend==='rising'?'<div class="ca-dlt up">▲ rising across term</div>':k.actTrend==='declining'?'<div class="ca-dlt dn">▼ declining across term</div>':'<div class="ca-dlt fl">− steady across term</div>';
  let b=tabs('ca-overview');
  b+='<div class="stat-grid">'
    +'<div class="stat"><div class="stat-v">'+k.act+'</div><div class="stat-l">Active youth</div>'+at+'</div>'
    +'<div class="stat"><div class="stat-v">'+k.avgFri+'</div><div class="stat-l">Avg Friday</div>'+dl(k.svcD)+'</div>'
    +'<div class="stat"><div class="stat-v">'+(k.act?Math.round(k.inLG/k.act*100):0)+'%</div><div class="stat-l">In a lifegroup</div>'+dl(k.grpD)+'</div>'
    +'<div class="stat"><div class="stat-v">'+k.decisions+'</div><div class="stat-l">Decisions</div><div class="ca-dlt fl">this term</div></div>'
    +'</div>';
  const max=m.rungs[0].v||1;
  const cols=['#0f1f3a','#1b3a6b','#2563eb','#4a82f0','#7aa8f7'];
  b+='<div class="card"><div class="ca-ct">Integration ladder</div>'+m.rungs.map((r,i)=>'<div class="ca-lrow"><div class="ca-lname">'+r.lb+'</div><div class="ca-lbar"><div class="ca-lfill" style="width:'+Math.max(8,Math.round(r.v/max*100))+'%;background:'+cols[i]+'">'+r.v+'</div></div></div>').join('')+'</div>';
  const row=(g,chip)=>'<div class="ca-alr" onclick="CA.showGroup(\''+g.id+'\')"><div style="font-size:.78rem;font-weight:600">'+g.name+'</div>'+chip+'</div>';
  const tops=m.groups.slice().sort((a,b)=>b.trendPct-a.trendPct||b.va-a.va).slice(0,2);
  b+='<div class="card"><div class="ca-ct">Group highlights</div>'
    +(tops.length?tops.map(g=>row(g,'<span class="chip '+(g.trendPct>0?'c-success':'c-neutral')+'">'+(g.trendPct>0?'▲ +'+g.trendPct+'pp':'− level')+'</span>')).join(''):'<div style="font-size:.74rem;color:var(--ca-muted)">No group data yet</div>')
    +'</div>';
  const aDecl=m.groups.filter(g=>g.trend==='declining').sort((a,b)=>a.trendPct-b.trendPct).map(g=>[g,'<span class="chip c-danger">▼ Declining '+g.trendPct+'pp</span>']);
  const aLoose=m.groups.filter(g=>g.loose).map(g=>[g,'<span class="chip ca-cw">Wide but loose</span>']);
  const alerts=[...aDecl,...aLoose].slice(0,2);
  b+='<div class="card"><div class="ca-ct">Group alerts</div>'
    +(alerts.length?alerts.map(([g,c])=>row(g,c)).join(''):'<div style="font-size:.74rem;color:var(--ca-muted)">No alerts — groups look healthy</div>')
    +'</div>';
  caShell(b,'ca-overview');
}
```

- [ ] **Step 2: New router + return object** (replaces the Task 3 stubs):

```js
// ---------- router ----------
function dispatch(p){
  if(p==='ca-overview')rOverview();
  else if(p==='ca-funnel')rFunnel();
  else if(p==='ca-groups')rGroups();
  else if(p==='ca-people')rPeople();
  else if(p==='ca-data')rData();
  else if(p==='ca-deck')rDeck();
  else{S.page='ca-hub';rHub();}
}
async function render(p){
  if(!S.user||!['director','admin'].includes(S.user.role)){go('home');return;}
  await load(p==='ca-hub'||!D); // refresh data when entering via the hub
  restore();mdl=null;
  dispatch(p);
}
return{render,reset,stale,seedOn,dismissWarn,
  model:async()=>{await load();restore();return model();},
  fquad,gfilter,pick,upload,showPerson,showGroup,exportMenu,exportQuad,buildDeck,
  pq,pstage,pquad,pdec,pmore};
```

Until Tasks 5–6 land, add temporary one-line stubs ABOVE the return so the references resolve (deleted as each real one lands):

```js
function rFunnel(){caShell(tabs('ca-funnel')+'<div class="card">pending</div>','ca-funnel');}
function rGroups(){caShell(tabs('ca-groups')+'<div class="card">pending</div>','ca-groups');}
function rPeople(){caShell(tabs('ca-people')+'<div class="card" id="ca-plist">pending</div>','ca-people');}
function rData(){caShell(tabs('ca-data')+'<div class="card">pending</div>','ca-data');}
function rDeck(){caShell('<div class="card">pending</div>','ca-deck');}
function fquad(){}function gfilter(){}function pick(){}function upload(){}function showPerson(){}function showGroup(){}function exportMenu(){}function exportQuad(){}function buildDeck(){}function pq(){}function pstage(){}function pquad(){}function pdec(){}function pmore(){}
```

- [ ] **Step 3: Syntax + harness** — hub (`Build Presentation`) and overview (`Integration ladder`, `Group highlights`) markers green; banner-on-Overview green.
- [ ] **Step 4: Commit** — `git -c core.autocrlf=true commit -am "feat(ca): shell, router, hub + overview screens"`

---

### Task 5: Funnel (+ per-quad), Lifegroups (+ filters, modal)

**Files:** Modify the CA module only — replace the `rFunnel`/`rGroups`/`fquad`/`gfilter`/`showGroup` stubs.

- [ ] **Step 1: Funnel.** Identical logic to the demo's `rFunnel` + `fquad` (demo plan Task 6 + the per-quad addition), with these substitutions: `QL`→`QLBL`; quad of a person `cq(p.s.grade,p.s.gender)`→`p.s.quad` (SPA students carry `quad`); quad chip class `q'+q`→`quad-'+q`; button classes `btn bs bf`→`btn btn-secondary btn-full`. Full code:

```js
function rFunnel(){
  const m=model(),R=m.rungs;
  const cols=[['#16294a','#0f1f3a'],['#234a85','#1b3a6b'],['#3672ee','#2563eb'],['#5b8ff2','#4a82f0'],['#8cb3f8','#7aa8f7']];
  const convs=[];for(let i=1;i<R.length;i++)convs.push(R[i-1].v?Math.round(R[i].v/R[i-1].v*100):0);
  const leak=convs.indexOf(Math.min(...convs));
  let f='<div class="ca-fw">';
  R.forEach((r,i)=>{
    const w=Math.round(92-(92-30)*(i/(R.length-1)));
    f+='<div class="ca-fseg" style="width:'+w+'%;background:linear-gradient(180deg,'+cols[i][0]+','+cols[i][1]+')"><div class="ca-fv">'+r.v+'</div><div class="ca-fn">'+r.lb+'</div></div>';
    if(i<R.length-1){const c=convs[i];f+='<div class="ca-fpill'+(i===leak?' leak':'')+'"><b>'+c+'%</b> continue · '+(100-c)+'% drop'+(i===leak?' — leakiest':'')+'</div>';}
  });
  f+='</div>';
  const lost=R[leak].v-R[leak+1].v;
  const stuck=m.people.filter(p=>!p.caOnly&&p.stage===R[leak].n);
  const qc={};for(const p of stuck){const q=p.s&&p.s.quad;if(q)qc[q]=(qc[q]||0)+1;}
  const worst=Object.entries(qc).sort((a,b)=>b[1]-a[1])[0];
  let b=tabs('ca-funnel');
  b+='<div class="card"><div class="ca-ct">This term&#39;s conversion</div><div style="font-size:.62rem;color:var(--ca-muted);margin-bottom:10px">'+R[0].lb+' → '+R[4].lb+'</div>'+f+'</div>';
  b+='<div class="card" style="background:#fff5f5;border-left:3px solid var(--ca-rose)"><div style="font-size:.66rem;font-weight:800;color:#b91c1c;text-transform:uppercase;letter-spacing:.05em">Biggest leak</div><div style="font-size:.78rem;margin-top:3px">'+R[leak].lb+' → '+R[leak+1].lb+' loses <b>'+lost+' people</b>.'+(worst?' Largest cluster: '+(QLBL[worst[0]]||worst[0])+' ('+worst[1]+').':'')+'</div></div>';
  b+='<button class="btn btn-secondary btn-full" onclick="CA.fquad()">'+(FQ?'Hide quad funnels ▴':'View funnel per quad ▾')+'</button>';
  if(FQ){
    const RAMP=cols.map(c=>c[1]);
    for(const q of Object.keys(QLBL)){
      const qp=m.people.filter(p=>p.s&&p.s.quad===q);
      const qr=R.map(r=>({lb:r.lb,v:qp.filter(p=>p.stage>=r.n).length}));
      const qmax=qr[0].v||1;
      b+='<div class="card" style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px"><span class="chip quad-'+q+'">'+(QLBL[q]||q)+'</span><span style="font-size:.62rem;color:var(--ca-muted)">'+qr[0].v+' people</span></div>';
      b+=qr.map((r,i)=>'<div class="ca-lrow"><div class="ca-lname">'+r.lb+'</div><div class="ca-lbar"><div class="ca-lfill" style="width:'+Math.max(8,Math.round(r.v/qmax*100))+'%;background:'+RAMP[i]+'">'+r.v+'</div></div></div>').join('');
      if(qr[0].v>0){
        const qcv=[];for(let i=1;i<qr.length;i++)qcv.push(qr[i-1].v?Math.round(qr[i].v/qr[i-1].v*100):0);
        const ql=qcv.indexOf(Math.min(...qcv));
        b+='<div style="font-size:.62rem;color:var(--ca-muted);margin-top:6px">Leakiest: '+qr[ql].lb+' → '+qr[ql+1].lb+' · <b style="color:#b91c1c">'+qcv[ql]+'% continue</b></div>';
      }
      b+='</div>';
    }
    b+='<div style="font-size:.6rem;color:var(--ca-muted);text-align:center;margin:4px 0 8px">Upload-only people with no platform match have no quad and are excluded from these breakdowns.</div>';
  }
  caShell(b,'ca-funnel');
}
function fquad(){FQ=!FQ;rerender();}
```

- [ ] **Step 2: Lifegroups.** Demo's `gChip`/`gfilter`/`rGroups`/`showGroup` with substitutions (`chip cd/cs/cw/cn`→`chip c-danger/c-success/ca-cw/c-neutral`; KPI strip `sg/sc/sv/sl`→`stat-grid/stat/stat-v/stat-l`; members modal closes with `closeModal()`; "groups" subtitle says cohorts). Full code:

```js
function gChip(g){
  if(g.trend==='declining')return'<span class="chip c-danger">▼ Declining '+g.trendPct+'pp</span>';
  if(g.trend==='rising')return'<span class="chip c-success">▲ Rising +'+g.trendPct+'pp</span>';
  if(g.loose)return'<span class="chip ca-cw">Wide but loose</span>';
  return'<span class="chip c-neutral">− Stable</span>';
}
function gfilter(v){GF=GF===v?'':v;rerender();}
function rGroups(){
  const m=model();
  let gs=m.groups.slice();
  if(GF)gs=gs.filter(g=>g.trend===GF);
  gs.sort((a,b)=>Math.abs(b.trendPct)-Math.abs(a.trendPct)||a.va-b.va);
  const partPct=m.kpis.act?Math.round(m.kpis.inLG/m.kpis.act*100):0;
  const actLG=D.students.filter(s=>s.gA>0);
  const vaAll=actLG.length?+(D.students.reduce((t,s)=>t+s.gA,0)/actLG.length).toFixed(1):0;
  let b=tabs('ca-groups');
  b+='<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">'
    +'<div class="stat"><div class="stat-v" style="font-size:1.25rem">'+partPct+'%</div><div class="stat-l">Participation</div></div>'
    +'<div class="stat"><div class="stat-v" style="font-size:1.25rem">'+vaAll+'</div><div class="stat-l">Visits / active</div></div>'
    +'<div class="stat"><div class="stat-v" style="font-size:1.25rem">'+m.groups.length+'</div><div class="stat-l">Cohorts</div></div>'
    +'</div>';
  b+='<div class="ca-fch">'
    +'<span class="chip '+(GF==='rising'?'c-success':'c-neutral')+'" style="cursor:pointer" onclick="CA.gfilter(\'rising\')">▲ Rising</span>'
    +'<span class="chip '+(GF==='declining'?'c-danger':'c-neutral')+'" style="cursor:pointer" onclick="CA.gfilter(\'declining\')">▼ Declining</span>'
    +(GF?'<span style="font-size:.62rem;color:var(--ca-muted)">'+gs.length+' cohort'+(gs.length===1?'':'s')+'</span>':'')
    +'</div>';
  if(!gs.length)b+='<div class="card" style="text-align:center;color:var(--ca-muted);font-size:.78rem">No '+GF+' cohorts</div>';
  for(const g of gs){
    const col=g.trend==='declining'?'var(--ca-rose)':g.loose?'var(--ca-amber)':g.trend==='rising'?'var(--ca-green)':'var(--ca-teal)';
    b+='<div class="card" style="cursor:pointer" onclick="CA.showGroup(\''+g.id+'\')"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div style="font-size:.82rem;font-weight:700">'+g.name+'</div><div style="font-size:.62rem;color:var(--ca-muted)">'+g.enrolled+' enrolled · '+g.active+' active · '+g.va+' visits/active</div></div>'+gChip(g)+'</div><div class="ca-gb"><div class="ca-gbf" style="width:'+Math.round(g.breadth*100)+'%;background:'+col+'"></div></div></div>';
  }
  caShell(b,'ca-groups');
}
function showGroup(id){
  const g=model().groups.find(x=>x.id===id);if(!g)return;
  let h='<div class="mh"></div><div class="mt" style="font-size:1rem;font-weight:800;margin-bottom:6px">'+g.name+'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><span style="font-size:.72rem;color:var(--ca-muted)">'+g.enrolled+' enrolled · '+g.active+' active · '+g.va+' visits/active · '+g.weeksRun+' weeks run</span>'+gChip(g)+'</div>';
  h+='<div style="max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;border-top:1px solid var(--ca-line)">';
  for(const s of g.mem.slice().sort((a,b)=>b.gA-a.gA)){
    h+='<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--ca-line)"><div style="font-size:.8rem;font-weight:600">'+esc(s.fn+' '+s.ln)+'</div><div style="font-size:.72rem;color:var(--ca-muted)">'+s.gA+'/'+s.gT+' lifegroups · '+s.sA+'/'+s.sT+' Fridays</div></div>';
  }
  h+='</div>';
  h+='<button class="btn btn-secondary btn-full" style="margin-top:12px" onclick="closeModal()">Close</button>';
  modal(h);
}
```

(Delete the matching one-line stubs.)

- [ ] **Step 3: Syntax + harness** — `Biggest leak`, `Visits / active`, quad-expand assertions green.
- [ ] **Step 4: Commit** — `git -c core.autocrlf=true commit -am "feat(ca): funnel + per-quad funnels, lifegroup cohorts + filters + modal"`

---

### Task 6: People, Data, Deck

**Files:** Modify the CA module only — replace the remaining stubs.

- [ ] **Step 1: People.** Demo's `STG`/`plist`/`rPeople`/`pq`/`pmore`/`pstage`/`pquad`/`pdec`/`showPerson`/`exportMenu`/`exportQuad` with these substitutions, all else identical to the demo plan Task 8 code:
  - row container: `'<div class="li" style="cursor:pointer'+(p.caOnly?';border:1px dashed var(--ca-line)':'')+'" …>'`, body/title/sub classes `li-body/li-title/li-sub`
  - avatar: `ca-av` classes
  - chips: `c-accent` (stages 1–3), `c-success` (4–5), `c-neutral` (0), `ca-cw` (Not in platform), `c-danger` (Declining)
  - pips → attendance bar + text: `'<div style="font-size:.6rem;color:var(--ca-muted);margin-top:3px">'+s.sA+'/'+s.sT+' Fridays</div><div class="ca-lgbar"><i style="width:'+(s.sT?Math.round(s.sA/s.sT*100):0)+'%"></i></div>'`
  - quad filter test: `p.s.quad===PF.quad`; quad select options from `QLBL`
  - journey events: connect → decision → lifegroup → team (NO "First Friday" — no per-session data)
  - `closeM()`→`closeModal()`; `fmtDM`→`fmtD`; buttons `btn btn-secondary btn-full`; selects `class="fs ca-sel"`
  - `pstage/pquad/pdec` re-render via `rerender()`; `pq/pmore` re-render only `#ca-plist` (same as demo)
- [ ] **Step 2: Data + upload.** Demo plan Task 9 code with substitutions: synced slot subtitles use `sessSeries().length+' sessions · '+D.students.filter(s=>s.sA>0).length+' attenders · live from the platform'` and `m.groups.length+' cohorts · '+D.students.filter(s=>s.gT>0).length+' enrolled · live from the platform'`; icons are emoji (`✓`/`📥`) inside `.ca-uic` (drop `ic()` calls: `'<div class="ca-uic ok">✓</div>'`, `'<div class="ca-uic '+(sd?'wn':'ok')+'">📥</div>'`); upload success path ends `save();mdl=null;toast(…);rerender();`; the Export card button `class="btn btn-primary btn-sm"` calls `CA.buildDeck()`.
- [ ] **Step 3: Deck.** Demo plan Task 10 `rDeck` + `buildDeck` with substitutions:
  - `rDeck` keeps the `‹ Back to Overview` button (`btn btn-secondary btn-sm`, `go('ca-overview')`), emoji `📑` instead of `ic('log',…)`, platform classes per the mapping table.
  - `buildDeck` is **verbatim from the demo** (it generates a standalone HTML page — host classes are irrelevant) with exactly these replacements: `settings.ministryName`→`(D.settings.ministryName||'Youth Ministry')`; `settings.regN/settings.regD`→`(D.settings.regRateNumerator||3)/(D.settings.regRateDenominator||4)`; the sparkline values `SESSION_DATES.map(...students.filter(s.hist...))`→`sessSeries().map(x=>x.v)` and its caption `'Friday attendance · '+vals.length+' sessions · outliers excluded by the server'`; `fmtDM`→`fmtD`; methodology bullet about trends becomes: `'Personal trend compares each student&#39;s current-term attendance rate with their previous-term rate (students tracked both terms); cohort trend does the same per grade × gender.'`; the Fridays/lifegroups methodology bullet says data is read live from this platform's API. Keep the `<\/script>` escape exactly as in the demo — a literal `</script>` inside the string would terminate the SPA's script block.
- [ ] **Step 4: Syntax + full harness — ALL green.** Expected: `PASS ~40+ / FAIL 0`.
- [ ] **Step 5: Backend checks** — `npm run typecheck` and `npm run test` (no src changes; both must pass untouched).
- [ ] **Step 6: Commit** — `git -c core.autocrlf=true commit -am "feat(ca): people, data uploads, executive brief deck"`

---

### Task 7: Removal test

**Files:**
- Create: `Project 4 - Youth Apps\_ca-dev\ca-spa-remove-test.mjs`

- [ ] **Step 1:** Copy `_ca-dev\ca-remove-test.mjs` to `ca-spa-remove-test.mjs` and change only the SRC/OUT lines:

```js
const SRC = path.join(here, '..', 'youth-allocation-platform', 'public', 'index.html');
const OUT = path.join(here, 'spa-index.stripped.html');
```

and the temp filename `stripped.js` → `spa-stripped.js`.

- [ ] **Step 2:** Run it — expected `STRIPPED OK — no remnants, syntax valid`. Then boot the stripped file: `node "...\_ca-dev\ca-spa-harness.mjs" "...\_ca-dev\spa-index.stripped.html" --core-only` — expected `[core-only] PASS 1 / FAIL 0`.
- [ ] **Step 3:** No commit (artifacts live outside the repo).

---

### Task 8: Manual pass, docs, final commit

- [ ] **Step 1: Manual browser pass** — `npm run dev`, open http://localhost:4300:
  1. `director@youth.ministry` / `demo1234` → Connection Audit tile in Quick Actions → all 6 screens + hub; numbers reflect the real seeded backend data.
  2. Data tab: replace one CSV (3 rows, `Name,Date`, one made-up name) → toast counts, chip green, made-up name dashed in People.
  3. Funnel → per-quad expand; Lifegroups → filters + cohort modal (Close visible); People → search/filters/person sheet/quad export.
  4. Build presentation → 9-slide deck, S notes, currency footnote.
  5. `g79@youth.ministry` → no tile; direct nav redirected. Admin → Full Reset → audit reseeds (banner returns).
- [ ] **Step 2: Update `youth-allocation-platform/CLAUDE.md`** — in the function map table add: `| CA module (whole Connection Audit) | same names — ported as a delimited block; data via CA.load() → /students + /trends + /settings |`; in the divergence bullets add: "Connection Audit: personal trend is rate-based (no per-session per-student API); lifegroup health uses 12 grade×gender cohorts (no /lifegroups route); Connect/Decision/Team uploads are client-side localStorage (`ca_audit_v1`), cleared by Full Reset via the `adminAction` hook."
- [ ] **Step 3: Update `youth app demo/CLAUDE.md`** — in the CA bullet, replace "Re-align the real SPA later" sentiment if present; add: "Ported to the real SPA (`youth-allocation-platform/public/index.html`) on <date> — same block + `/*CA-HOOK*/` contract; SPA harness `../_ca-dev/ca-spa-harness.mjs`."
- [ ] **Step 4: Final verification** — syntax check, full SPA harness, `npm run typecheck`, `npm run test`, removal test: all green.
- [ ] **Step 5: Commit + merge**

```powershell
git -c core.autocrlf=true add -A
git -c core.autocrlf=true commit -m "docs(ca): CLAUDE.md alignment notes for Connection Audit port"
git checkout master; git merge connection-audit-sync
```

(The repo is local-only — no push/deploy; the app is a local reference on port 4300.)

---

## Plan self-review notes

- **Spec coverage:** every demo CA feature is mapped (hub/6 screens, quad funnels, group trend % + filters, highlights, modal close, currency banner, deck + Data-tab export + back button, per-quad follow-up export, removal contract). Degradations are explicit and documented in CLAUDE.md (Task 8), consistent with the established alignment doctrine.
- **Known accepted deviations:** personal trend/pips/journey differences (no per-student session API); cohort pseudo-groups; deck sparkline from server aggregates; `CA.model()` exposed as async wrapper; data refresh on hub entry only.
- **Type consistency check:** `QLBL` (not `QL`), `p.s.quad` (not `cq()`), `closeModal` (not `closeM`), `fmtD` (module-local), `rerender()` used by all filter handlers, `dispatch(p)` split from async `render(p)` so sync handlers can re-render without re-fetching.

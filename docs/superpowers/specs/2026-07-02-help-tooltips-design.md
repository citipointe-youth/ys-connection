# Help tooltips — design

**Date:** 2026-07-02
**Scope:** `public/index.html` (SPA only) — no backend/schema change.

## Why

The sister Camp Platform app (`youth-camp-platform-masterv2`) has a proven `helpTip()`
pattern giving leaders plain-language explanations of non-obvious UI/domain logic. CMS has
none yet. Owner asked for a small, high-value set added, budgeted per role so the UI doesn't
get cluttered:

- grade / quad / director: ≤3 tooltips across their shared "standard interface" screens
- director: 3-4 additional tooltips within the Connection Audit feature
- admin: 3-4 tooltips across Admin Settings + Import

## Mechanism (ported verbatim from Camp Platform)

- `.htip` / `.htip-pop` CSS — small circular "?" button, dark popover bubble positioned
  below the icon, centred by default or right-anchored via a `.tip-left` modifier for icons
  that end a heading row.
- `helpTip(text, opts)` — returns the button markup; `opts.left` sets `.tip-left`.
- `_toggleTip(e, btn)` — tap/click handler: closes any other open tip, opens this one, calls
  `_clampTip`.
- `_clampTip(btn)` — resets the bubble's transform, measures its bounding rect, and nudges it
  horizontally so it never runs past either viewport edge (8px margin). Called on tap and via
  a delegated `mouseover` listener (desktop hover).
- A document-level `click` listener closes any open tip when tapping elsewhere.

This is a direct port — same CSS class names, same clamping math — adapted to call CMS's
`esc()` helper (already present) for the `aria-label` and bubble text.

## Placements

### Standard interface (grade / quad / director shared code) — 3 total
Because these three roles render through the same functions, one set of 3 tooltips
satisfies the "≤3" cap for all three simultaneously.

1. **At-Risk screen** (`renderAtRisk`) — on the status legend/badge — explains Stopped /
   Declining / Regular (threshold-free; a stream's rate dropping ≥20pts vs last term, or
   never-engaged vs stopped). Highest-value: the least self-explanatory logic in the app.
2. **Leaders & Connect** (`renderConnectView`, search/picker area) — explains the
   gender + grade connection-scoping rule (a leader may connect another grade but only their
   own gender; grade/quad logins see only their gender). Addresses the most common
   "where did my student go" confusion.
3. **Home** (`renderHome`, connected/unconnected counts) — explains "connectable": only
   students who attended a service or lifegroup this or last term count; never-attended
   students are excluded from the totals.

### Connection Audit (director + admin, since admin also has `ca-hub`) — 4 total
1. CA Hub year/term switcher — it's a frozen year-to-date snapshot, not a live read.
2. Follow-up funnel — what Stage 1–5 mean.
3. Lifegroup Health table — why the average's denominator differs per scope (a named
   lifegroup divides by the weeks *it* met; grade/quad/overall divide by valid services in
   the term).
4. Export-by-quad button — what the CSV contains (follow-up list, one per quad).

### Admin (Admin Settings + Import) — 4 total
1. Admin Settings — Reset vs. Clear Service Group: Reset wipes everyone/everything; Clear
   Service Group keeps students/leaders/connections and only clears service/lifegroup data.
   Highest-value: prevents accidental full data loss.
2. Import screen — expected CSV columns/format for service and lifegroup uploads.
3. Admin Settings → Accounts — grade-login email convention (`g`/`b` suffix drives gender
   scoping for that account).
4. Admin Settings — Save Defaults — explains what gets snapshotted for year rollover.

## Copy style

Match the camp app: short (1-2 sentences), plain language, written for a leader who didn't
build the app, no jargon.

## Verification

`npm run typecheck` + `npm run test` (no dedicated UI test harness for this SPA — same
convention as the camp app: flag CSS/placement for the owner to eyeball on-device, don't spin
up a dev server). Manually sanity-check tooltip positions near a screen edge don't need a
browser session since `_clampTip` is a direct, previously-verified port.

## Deploy

`master` is linked to Vercel for `citipointe-youth/connection-made-simple` — a push to
`master` is the production deploy, per owner's explicit request to validate live.

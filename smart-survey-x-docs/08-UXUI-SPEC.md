# Smart Survey X — UX/UI Specification

**Version:** 1.0 (Locked)
**Depends on:** `01-PRD.md`, `02-BRS.md`, `03-FRS.md`
**Applies to:** Surveyor App (Flutter), Admin/Reviewer/Viewer Web Portal (Next.js)

---

## 0. Design Brief (grounding)

The subject: field workers standing in bright sunlight, weak signal, often one-handed while holding a phone and a clipboard, filling in a form under time pressure — next to office-based admins reviewing that same data on a desk monitor, cross-referencing an audio recording against typed answers. The product has to feel like a **precision instrument**, not a consumer form-builder toy: calm, legible, fast to scan, trustworthy enough that a Client Admin trusts a "Approve" tap. "Premium and light" here means restraint and clarity — generous whitespace, one accent color used sparingly for meaning (not decoration), and typography doing the work instead of visual noise.

This is a **shared design language across two very different surfaces** (native mobile field tool vs. data-dense web dashboard) — the token system below is what keeps them feeling like one product.

---

## 1. Design Tokens

### 1.1 Color

| Token | Hex | Usage |
|---|---|---|
| `color/bg/base` | `#FAFAF8` | App/page background — warm off-white, not stark white (reduces glare in sunlight use) |
| `color/bg/surface` | `#FFFFFF` | Cards, form panels, modals |
| `color/bg/sunken` | `#F1F0EC` | Input fields at rest, table stripes |
| `color/ink/primary` | `#1C1E1B` | Primary text — near-black, warm undertone, not pure #000 |
| `color/ink/secondary` | `#5B5E58` | Secondary text, labels, captions |
| `color/ink/muted` | `#9A9D96` | Placeholder text, disabled labels |
| `color/border/default` | `#E4E2DB` | Default hairline borders |
| `color/border/focus` | `#2F6F5E` | Focus rings, active input border |
| `color/accent/primary` | `#2F6F5E` | **Single primary accent** — deep teal-green. Primary buttons, active nav state, links, selected states. Chosen for: reads as trustworthy/verification (audit, approval) rather than urgency; distinct from generic SaaS blue and from Anthropic's own terracotta. |
| `color/accent/primary-hover` | `#265B4D` | Primary accent hover/pressed state |
| `color/accent/primary-tint` | `#E7F1EE` | Accent background tint (selected row, active filter chip) |
| `color/status/success` | `#2F7D4F` | Approved, synced, validation passed |
| `color/status/success-tint` | `#E9F5EC` | Success background (badges, banners) |
| `color/status/warning` | `#B7791F` | Pending review, sync retrying, draft |
| `color/status/warning-tint` | `#FBF1E1` | Warning background |
| `color/status/danger` | `#B3402C` | Rejected, validation error, destructive action |
| `color/status/danger-tint` | `#FBEAE6` | Danger background |
| `color/status/info` | `#3B6FA0` | Informational badges only (not interactive) |
| `color/gis/scale-1..5` | `#EAF3EF → #2F6F5E` | 5-step sequential ramp (same hue family as accent) for choropleth map shading — keeps GIS visuals in-family rather than an unrelated rainbow scale |

**Rule:** exactly **one** accent hue (`accent/primary`) is used for anything interactive/brand. Status colors (`success`/`warning`/`danger`/`info`) are used **only** to communicate state, never as decoration, never as a second "brand" color. This single rule is what prevents the "clumsy" look you flagged — competing accent colors are the most common cause of a UI feeling unplanned.

### 1.2 Typography

| Role | Typeface | Notes |
|---|---|---|
| Display / headings | **Inter** (600/700) | Clean, highly legible at small sizes on mobile in bright light; avoids a "generic SaaS" feel when paired with the restrained color system rather than a default blue |
| Body | **Inter** (400/500) | Same family as display, weight does the differentiating — one font family end-to-end keeps both surfaces (Flutter + web) trivially consistent, and avoids web-font loading jank on low-connectivity |
| Numeric / data / IDs | **Inter** (tabular figures, `font-feature-settings: 'tnum'`) | Record IDs, timestamps, stats — tabular numerals so columns of numbers align |

**Type scale** (both platforms share this ratio, ~1.25 minor-third):

| Token | Size | Weight | Usage |
|---|---|---|---|
| `text/display` | 28px / 34px (mobile: 24/30) | 700 | Screen titles (Admin dashboard headers) |
| `text/h1` | 22px / 28px | 600 | Section headers |
| `text/h2` | 18px / 24px | 600 | Card titles, question group headers |
| `text/body` | 15px / 22px | 400 | Default body/form text |
| `text/body-medium` | 15px / 22px | 500 | Emphasized body, button labels |
| `text/caption` | 13px / 18px | 400 | Timestamps, helper text, stamps |
| `text/label` | 12px / 16px, uppercase, +0.04em tracking | 600 | Field labels, status badges |

### 1.3 Spacing & Layout

8px base unit. `space-1`=4, `space-2`=8, `space-3`=12, `space-4`=16, `space-5`=24, `space-6`=32, `space-7`=48, `space-8`=64.

- Mobile (Surveyor App): single-column, minimum 48×48px touch targets (field-glove/one-handed use), content max-width unconstrained (native).
- Web (Admin Portal): 12-column grid, content max-width 1440px, sidebar nav 240px fixed, generous 24–32px card padding — "light" comes from whitespace discipline, not from thin borders alone.

### 1.4 Radius, Elevation, Motion

- `radius/sm` = 6px (inputs, chips) · `radius/md` = 10px (cards, buttons) · `radius/lg` = 16px (modals, bottom sheets)
- Elevation is expressed via a single soft shadow token (`0 1px 3px rgba(28,30,27,0.06), 0 1px 2px rgba(28,30,27,0.04)`), used sparingly — flat/bordered surfaces are the default; shadow only on floating elements (modals, dropdowns, the mobile "record in progress" sticky bar).
- Motion: 150ms ease-out for micro-interactions (button press, toggle), 200ms for panel/sheet transitions. No decorative animation. Respect `prefers-reduced-motion`.

---

## 2. Component States — Button System (the "no clumsy combinations" spec)

One button component, four variants, five states — used identically on both platforms:

| Variant | Default | Hover (web) | Pressed | Disabled |
|---|---|---|---|---|
| **Primary** | bg `accent/primary`, text white | bg `accent/primary-hover` | bg `#1F4B3F`, scale 0.98 | bg `#C8CFC A` tint of accent at 40% opacity, text `ink/muted` |
| **Secondary** | bg transparent, border `border/default`, text `ink/primary` | border `accent/primary`, text `accent/primary` | bg `accent/primary-tint` | border `border/default` at 50% opacity, text `ink/muted` |
| **Destructive** | bg transparent, border `status/danger`, text `status/danger` | bg `status/danger-tint` | bg `status/danger` text white | opacity 40% |
| **Ghost/Tertiary** | transparent, text `ink/secondary` | text `ink/primary`, bg `bg/sunken` | bg `border/default` | text `ink/muted` |

**Rules that keep this consistent everywhere:**
1. Exactly one **Primary** button per screen/section (the one deliberate next action — e.g. "Approve", "Publish", "Submit"). Never two primary buttons competing for attention.
2. Destructive variant is reserved for irreversible/rejecting actions only (Reject record, Delete question, Suspend tenant) — never for routine negative actions like "Cancel" (that's Ghost).
3. Status badges (pill-shaped, `text/label` token, tint background + solid text of the matching status color) are the **only** place status colors appear as fills — never recolor a button to a status color.
4. Icons inside buttons are always from one icon set (Lucide, per the tech constraints below) at 18px inside 40–48px targets, never mixed icon styles.

---

## 3. Surveyor App — Key Screens (Flutter)

Design intent: **calm, high-contrast-enough-for-sunlight, minimal chrome, one primary action visible at a time.**

1. **Login** — phone/email + password, minimal branding, works fully offline against cached session on relaunch.
2. **Profile (read-only)** — photo, name, phone, government ID badge, Surveyor ID displayed as a non-editable card at the top of a drawer/menu; no pencil/edit icon anywhere on this screen (per BR-035) — the absence of an edit affordance *is* the design signal.
3. **Campaign List** — cards: campaign name, geography scope, record count so far, sync status summary. Pull-to-refresh triggers sync attempt (visually distinct from "offline, cached" state via a small `warning`-tinted banner, not a blocking modal).
4. **New Record Flow**:
   - Step 1 (auto, blocking): camera opens → photo capture → GPS acquiring (spinner with "Locking location…" `text/caption`) → both lock with a satisfying, non-decorative checkmark confirmation. This step cannot be skipped (FR-EVD-06).
   - Step 2 (auto): audio recording indicator appears as a persistent, unobtrusive sticky top bar (red dot + waveform + elapsed time) visible across all subsequent form screens until pause/submit.
   - Step 3: form renders per template, one question (or logical group) per screen-scroll, native input control per type (§8e closed set) — numeric keypad, calendar, single/multi-select as chips, scale as a segmented control.
   - **Pause** (Ghost button, top-right) → confirms, saves to Drafts, stops nothing evidence-wise (audio keeps recording state persisted).
   - Drafts screen: list of paused records, tap to resume exactly where left off, audio playback control available inline while reviewing/filling.
   - **Submit** (Primary button, bottom, only enabled when all required fields valid) → confirmation sheet showing stamp summary → final lock.
5. **Activity Log** — flat list, each row: Record ID, campaign, submitted date, status badge (`Pending Review` warning-tint / `Approved` success-tint / `Rejected` danger-tint). Tapping a row expands only metadata (per BR-036) — never the answer content.
6. **Sync Status** — small persistent indicator (not a screen) in the app's top bar: cloud icon states (queued grey / syncing accent-pulsing / synced success-check / failed-retry warning) — this is the single most important trust signal for a low-connectivity app, so it is always visible, never buried in a settings screen.

## 4. Admin Web Portal — Key Screens (Next.js)

Design intent: **data-dense but calm, one accent color for action, generous scan-ability for a reviewer doing many records in a row.**

1. **Dashboard (per-survey, auto-generated)** — top: KPI card row (`bg/surface`, hairline border, large tabular numeral + `text/label` caption). Below: filter bar (chips, `accent/primary-tint` when active) spanning geography/date/question filters. Grid of chart widgets (bar/pie/trend) + a map panel (GeoJSON choropleth using the `gis/scale` ramp, degrading to pin/list per FR-GIS-02). Layout auto-generated from metadata but drag-reflow-able (small "rearrange" ghost-button toggle, not always-on edit mode).
2. **Review Queue** — table/list of `pending_review` records; clicking one opens a **Review Detail** split view: left = typed answers (grouped, scannable), right = locked photo + GPS pin (small static map) above an inline audio player with scrub bar, plus the full data-stamp timeline (`text/caption`, muted). Approve (Primary) / Reject (Destructive, requires reason textarea) fixed at the bottom, always visible without scrolling (sticky action bar).
3. **Survey Builder** — left: question list (drag handles, reorder), center: live form preview (mirrors the actual Surveyor App rendering, so the admin sees exactly what the field sees), right: metadata inspector panel for the selected question (validation rules, GPS/photo/audio requirement toggles, chart-type hint, visibility rules) — all from the closed metadata set in PRD §7.
4. **Assignment Manager** — a matrix/list view: surveyors × their current form assignment, with quick add/remove/reassign controls inline (dropdown per row) per FR-ASG-04 — no need to navigate into a separate campaign screen to make this change.
5. **Team & Activity** — Client Admin (Main) view listing their Sub Admins and Dashboard Viewers with seat-limit indicators ("1 of 2 Sub Admin seats used — Request more"), and a per-actor activity log table (actor, action, entity, timestamp), filterable.
6. **Tenant data export** — simple panel: (Super Admin only) tenant selector + format + "Request Export" Primary button → async job status → download link when ready. Client Admin sees the same panel with no selector, implicitly scoped.

## 4a. States Beyond the Happy Path (loading, error, empty, degraded)

A "premium" feel is decided more by these states than by the happy path — this is where most field/data apps look cheap. Every screen in §3 and §4 must define all four states below before it's considered spec-complete; a screen with only a happy-path mock is not done.

### 4a.1 Loading states

- **Skeleton screens, not spinners**, for anything with a known layout (dashboard widgets, record lists, review detail) — a gray pulsing placeholder shaped like the eventual content reduces perceived wait and avoids layout jump when data arrives.
- **A bare spinner is acceptable only** for genuinely unknown-duration/unknown-shape waits: GPS lock acquisition, initial app launch auth check, file upload progress (which gets a determinate progress bar instead, once byte count is known).
- No loading state may block longer than ~400ms before showing *something* — even a skeleton — per the "connectivity never blocks the surveyor" principle extended to perceived responsiveness generally.

### 4a.2 GPS acquisition — explicit slow-case design (real field condition, not edge case)

This is a **primary** state, not an edge case, for a field-collection tool — rural/indoor GPS lock can genuinely take 30–60+ seconds:

- 0–5s: spinner + "Locking location…" (`text/caption`, `ink/secondary`)
- 5–20s: same, plus a subtler secondary line: "This can take a moment outdoors" (sets expectation, reduces the feeling of a hang)
- 20s+: escalate to an actionable state — icon changes to a `warning`-tinted indicator, text becomes "Still searching — move to an open area if possible," **plus a manual Retry action** and, if the template's metadata marks GPS as required-but-the-organization-allows-a-fallback (an admin-configurable tolerance, not a default), an option to proceed with a flagged "GPS unavailable" marker rather than being stuck indefinitely. (If GPS is strictly mandatory per template metadata with no fallback, the surveyor instead sees a clear "Cannot start record without location — try again" state with Retry, never a silent infinite spinner.)

### 4a.3 Sync status — the multi-record case

Beyond the single persistent icon described in §3 point 6, the **expanded Sync Status panel** (tap the icon to open) shows a real list, because "syncing" is rarely one record in practice:

- Grouped by status: "3 synced," "2 syncing," "1 failed — will retry," each with a count badge in the matching status color (tint background, per UX §1.1/§2 rule 3).
- A failed-and-retrying record shows **why**, in plain language, if known ("Waiting for a stronger connection" vs. "Server error — will retry automatically") — never a bare error code to a field surveyor.
- Manual "Retry now" action available per-record and as a "Retry all" bulk action, for when the surveyor knows they've just regained signal and don't want to wait for the automatic backoff interval.

### 4a.4 Empty states

- **Campaign List, no assignments yet**: not a blank screen — an illustration-free, calm message ("No campaigns assigned yet — check back after your admin sets you up") with no false call-to-action (no "Create Campaign" button, since surveyors can't create one).
- **Activity Log, no submissions yet**: "Your submitted records will show up here" — sets expectation without implying an error.
- **Dashboard, campaign published but zero approved records yet**: distinct from a loading or error state — an explicit "No approved records yet" message with a small explainer ("Records appear here once reviewed and approved") so a Client Admin doesn't mistake this for a broken dashboard (directly relevant given the review-gate architecture, where a genuinely active campaign can legitimately show an empty dashboard for a while).

### 4a.5 Error states

- **Structural validation error** (question-level, per FR-VAL-02): inline under the specific field, `status/danger` text, plain language ("Enter a number between 18 and 120," not "ValueError: out of range") — never a top-of-screen generic banner for a field-level problem.
- **Server/network error on an admin action** (e.g. publish fails): a dismissible banner near the action taken, `status/danger-tint` background, states what happened and what to do ("Publish failed — check your connection and try again" with a Retry button), never a raw stack trace or HTTP status code surfaced to the user.
- **Permission error (403)**: should be rare in the UI (since buttons for unavailable actions shouldn't render per role in the first place — UX is a courtesy, security is server-enforced per Security §2), but if reached (e.g. a stale cached UI state), the message is calm and specific: "You don't have permission to do this" — not a technical exception dump.

### 4a.6 Degraded/offline banner (Surveyor App, persistent, non-blocking)

A slim, non-modal banner (not a full-screen takeover) appears whenever the app has no connectivity: `warning`-tint background, "Working offline — will sync when connected." It never blocks interaction with the rest of the screen underneath it, consistent with BR-039's "connectivity never blocks data entry" requirement being a *visual* promise, not just a backend one.

---

## 4b. Dashboard Widget & Shell States (analytics-specific, extends §4a)

Every dashboard screen and every individual widget must implement these four states explicitly — this is dashboard/widget-specific detail beyond the general loading/error/empty/degraded principles in §4a. Do not collapse them into a single spinner or a blank panel.

| State | When | UI treatment |
|---|---|---|
| **Loading** | Initial fetch or filter change in flight | Skeleton placeholders matching widget layout (KPI cards, chart blocks, map). No layout jump when data arrives. |
| **Empty** | Zero approved facts for the current filter set | Calm message: "No approved records yet" (or "No records match these filters"). Short explainer: "Records appear here once reviewed and approved." No chart axes with zero; no fake zeros that look like real data. |
| **Degraded** | Partial capability (e.g. map without GeoJSON boundaries, or a stale aggregate) | Widget still renders what it can (e.g. pin-only map). Non-blocking chip or caption: "Boundary data unavailable — showing pins" or "Data may be delayed." |
| **Error** | Request failed | Inline error with Retry. Do not blank the whole dashboard if only one widget fails. |

**Shell requirements:**
- Header always shows **"Data as of {relative time}"** (from the `data_as_of` field, Analytics Spec §5/§8). Use `text/caption`, `ink/secondary`.
- If lag exceeds 2× the expected refresh interval (FR-DSH-03), show a warning chip (`status/warning` tint): "Analytics may be delayed."
- Filter bar remains interactive during loading; applying a new filter cancels the in-flight request and starts a fresh one — never a locked/disabled filter bar while a previous query is still resolving.
- The Surveyor Performance system widget and submissions KPI (Analytics Spec §3) follow the same empty/loading rules as metadata-derived widgets — no special-casing.

**Map-specific:**
- `mode: choropleth` when boundary data exists; `mode: pins` when degraded (Analytics Spec §5.1).
- An empty map (no points, no shapes) uses the same calm empty-state copy as other widgets, never a broken-map-tile visual.



## 4c. Micro-interaction Details (the difference between "fine" and "premium")

- **Button press feedback**: the 0.98 scale + darker fill on Primary press (UX §2 table) must complete within the 150ms token (§1.4) — a press that feels laggy undermines "premium" faster than almost anything else in a mobile app.
- **Success confirmation on photo/GPS lock** (§3 point 4, step 1): a brief (300–400ms) checkmark animation, not an abrupt cut to the next screen — gives the surveyor a felt sense that the lock genuinely happened, important since this data becomes immutable.
- **Haptic feedback** (mobile only): a light haptic tap on successful record submission and on Approve/Reject-adjacent actions where available — reinforces "this action landed" in bright-sunlight conditions where visual confirmation alone may be missed.
- **Pull-to-refresh** on Campaign List and Activity Log uses the `accent/primary` spinner color, not a platform-default gray, keeping even system-provided interactions inside the token system.



## 5. Accessibility & Quality Floor

- All interactive elements have a visible keyboard focus ring (`border/focus`, 2px, offset 2px) on web.
- Minimum contrast: body text 4.5:1, large/label text 3:1 against their backgrounds (all token pairs above were chosen to satisfy this — verify computationally if colors are adjusted later).
- Mobile touch targets minimum 48×48px (field-use, gloves/sunlight/urgency considered).
- Respect `prefers-reduced-motion`; no motion is load-bearing for understanding any state.
- Error states are specific and instructive (per FR-VAL-02: question-level errors), written in plain language, never a bare "Error."

---

## 6. Implementation Notes for Code Agents

- Web: implement tokens as CSS custom properties / Tailwind theme extension — do not hardcode hex values in components.
- Flutter: implement tokens as a single `AppTheme`/`ThemeExtension` class — same token names as the web CSS variables (kept in a shared `design-tokens.json` if feasible) so both platforms visibly drift together, not apart, as the product evolves.
- Icon set: Lucide (matches the available React icon library per platform constraints; use the closest equivalent icon pack on Flutter for visual parity, not a differently-styled icon set).
- Do not introduce a second accent color, a second font family, or ad-hoc one-off colors for a "just this one button" case — if a new state genuinely isn't covered by this token set, treat that as a gap to raise (log in `13-ADR-LOG.md`), not license to invent a new color inline.

---
*Next document: `04-BUSINESS-RULES.md` (Validation & Business Logic Rules Engine)*

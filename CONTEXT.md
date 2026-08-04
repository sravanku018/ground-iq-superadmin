# CONTEXT

## Current Task
Legacy data (2214 rows: excel-upload + old app, no GPS/camera) made a separate survey + exempt from strict geo/voice/photo checks; auto-confirmed. DEPLOYED and verified live. One pending redeploy: /api/submissions slice fix (filtered views fetch up to 5000 so all legacy rows visible in Review).

## Key Decisions
- Legacy rows = payloads with no `geo` (2214 of 2225). Migration (runs in ensureSchema on deploy): sets form_key='legacy', status='confirmed', confirmed_by='system (legacy migration)', creates survey_form row "Legacy Data (no GPS/Camera)". Idempotent.
- verifySubmission: legacy rows (no geo + no media/flags) get completeness=complete if ≥1 answer; geo/voice/photo checks n/a. New data still strict.
- Portal Review shows "legacy (no GPS/camera)" badge on legacy rows.
- MP/MLA location-scope work fully reverted (user cancelled) — server + UI back to plain survey create.
- Respondents tracker removed from Surveys tab (Review tab covers confirm/reject).
- Signing key: original lost; current android/app/election-survey-release.jks (GroundIQ2026!, alias election_survey) is now official — old installs need one-time uninstall. Backup in ~/Downloads/election-survey-release-jks-BACKUP.jks.
- AndroidManifest now declares GPS/camera/mic permissions; APK scripts copy output to project folder + ~/Downloads (npm run build:apk:release).
- Field app: Drafts tab is now "Pending" — shows drafts + queued/failed records with record numbers ("Name · Record #N"); drafts get recordIndex on save.

## Next Steps
- ONE more deploy (dash.deno.com → jazzy-crocodile-7790): paste updated main.ts (commit 13462c7) so /api/submissions with filters fetches 5000 rows — otherwise ~1200 old legacy rows are unreachable in Review. Verified locally; live deploy still on the version deployed earlier (migration ran, slice fix not yet live).
- q_/survey filters in submissions+analyze, age buckets (7779821, 6fdaee8) still not on dash.deno.com (may already be included in 13462c7's main.ts — verify after deploy).
- User: uninstall old app, install ~/Downloads/ElectionSurvey-release.apk (1.7.0), test vanishing; if persists, run adb logcat for crash.
- Commit 13462c7 pushed for legacy task; working tree: src/FieldCollect.jsx + src/SurveyorApp.jsx still modified (uncommitted, prior draft-record work).

## Reminders
- Deployed web = current admin build (verified bundle match).
- Commit: 13462c7 pushed for legacy task; working tree: src/FieldCollect.jsx + src/SurveyorApp.jsx modified (uncommitted, prior draft-record work).
- Deployed & verified live: portal Surveys tab shows "Legacy Data (no GPS/Camera)" with 2214 submissions, all confirmed; Report includes them immediately (legacy exempt from complete filter).

# CONTEXT

## Current Task
Legacy data (2214 rows: excel-upload + old app, no GPS/camera) made a separate survey + exempt from strict geo/voice/photo checks; auto-confirmed on redeploy. DONE in code, needs deploy.

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
- Pending server redeploy: legacy-survey migration + strict-check exemption (this task), q_/survey filters in submissions+analyze, age buckets (7779821, 6fdaee8) still not on dash.deno.com.
- User: uninstall old app, install ~/Downloads/ElectionSurvey-release.apk (1.7.0), test vanishing; if persists, run adb logcat for crash.
- Todo list now stale in file below — main.ts changes were reverted; last push: 1f0f779 (record numbers).

## Reminders
- Deployed web = current admin build (verified bundle match).
- Commit: 1f0f779 pushed; working tree clean.
- After redeploy, portal Surveys tab shows "Legacy Data (no GPS/Camera)" with 2214 submissions, all confirmed; Report includes them immediately (legacy exempt from complete filter).

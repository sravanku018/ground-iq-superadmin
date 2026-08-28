# CONTEXT

**Next CLI: read `HANDOFF.md` first** (live API URL, no paste, Python push, voice limits, CORS).

## Current Task
Dashboard/export/UI overhaul committed (c16c0c3) but NOT deployed: Report "By survey" board (records, surveyors, locations per survey); Data tab "Export" (CSV text file with photo+audio links, filters: day/month/today/total/surveyor/survey/district/assembly/status) via new /api/admin/export; field app auto-colored option buttons + new 'sentiment' question type (green/amber/red, also in report); Surveys tab edits name+questions+team in one detail screen; q_ filter TDZ crash fixed in /api/analytics; ageBucket handles "26-35 years" ranges; legacy survey seeded with 10 questions (Gender/Caste/Age/Education/Employment/Performance/Party/PM/Ward/Issues) so Report shows filters+charts for legacy. Verified locally (by_survey rows, export 2214 legacy rows).

## Key Decisions
- Legacy rows = payloads with no `geo` (2214 of 2225). Migration (runs in ensureSchema on deploy): sets form_key='legacy', status='confirmed', confirmed_by='system (legacy migration)', creates survey_form row "Legacy Data (no GPS/Camera)". Idempotent. Backfill UPDATE seeds legacy questions ONLY when questions array is empty — already seeded, will not re-run.
- verifySubmission: legacy rows (no geo + no media/flags) get completeness=complete if ≥1 answer; geo/voice/photo checks n/a. New data still strict.
- Portal Review shows "legacy (no GPS/camera)" badge on legacy rows.
- Export reuses hoisted loadAnalyticsRows() (AC→district resolution shared with buildAnalytics); media links = survey_media.url (/api/media/:id/file). Export filters by created_at.
- MP/MLA location-scope work fully reverted (user cancelled) — server + UI back to plain survey create.
- Respondents tracker removed from Surveys tab (Review tab covers confirm/reject).
- Signing key: original lost; current android/app/election-survey-release.jks (GroundIQ2026!, alias election_survey) is now official — old installs need one-time uninstall. Backup in ~/Downloads/election-survey-release-jks-BACKUP.jks.
- AndroidManifest now declares GPS/camera/mic permissions; APK scripts copy output to project folder + ~/Downloads (npm run build:apk:release).
- Field app: Drafts tab is now "Pending" — shows drafts + queued/failed records with record numbers ("Name · Record #N"); drafts get recordIndex on save.

## Next Steps
- Deploy c16c0c3's deno-deploy/main.ts to dash.deno.com → jazzy-crocodile-7790 (brings q_ filter fix, legacy question filters, by_survey board, export endpoint). Then verify live: /api/analytics?report=locked shows by_survey; /api/admin/export?survey=legacy returns 2214 rows.
- Rebuild + deploy web admin bundle (npm run build passed) — includes Dashboard board, Surveys editor, Export tab.
- New APK build for colored/sentiment buttons (npm run build:apk:release).
- Working tree clean after c16c0c3.

## Reminders
- Deployed web = current admin build (verified bundle match).
- Legacy deploy (13462c7, pushed): live verified — Surveys tab shows "Legacy Data (no GPS/Camera)" 2214 submissions confirmed; Report includes them. Slice fix (5000-row fetch) was NOT in that live deploy; q_ filters live still 500 until c16c0c3 deployed.

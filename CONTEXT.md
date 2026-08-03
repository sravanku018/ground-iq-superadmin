# CONTEXT

## Current Task
Report/Analyze filters + charts now form from Client Admin's question naming everywhere data is analyzed (Report, Analyze, Review, Raw data, Geography map).

## Key Decisions
- Server: answerOf() matches answer keys to question id OR label, case-insensitive; surveyQuestions built from selected form or union of all forms; questionCharts dynamic.
- q_ + survey filters added to /api/submissions and /api/admin/analyze; AdminAnalyze passes them to board, list, charts.
- Geo aliases inlined into main.ts (single-file Deno Playground deploy); no telangana-aliases.json import.

## Next Steps
- User redeploys deno-deploy/main.ts to dash.deno.com (commits 7779821 + ebb89dc; latest ebb89dc).
- Verify questionCharts + q_ filtering live after redeploy.
- Pending: admin read-note text/location (blocked on user), GHMC/Municipal forms have no questions.

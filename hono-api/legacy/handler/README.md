# handler/ — Election Survey API (split from the old 13k-line handler.ts)

Entry: `../handler.ts` re-exports `handleRequest` (same import path as before for hono-api/main.ts) and keeps the `Deno.serve` for `deno run -A --env handler.ts`.

```
handler/
  router.ts            CORS preflight, APK, DB/schema ready, auth (token -> me), runs ROUTES in order
  routes/              one module per feature; each exports handleX(c: Ctx) => Response | null
    ctx.ts             Ctx type: req, url, path, method, m, token, me, redispatch
    public.ts          /, /api/health, /api/app-version, /api/auth/login
    auth.ts            device-token/device-login, WebAuthn
    conversations.ts   voice conversations + /api/transcribe
    aliases.ts         410 Gone routes + legacy route aliases (redispatch)
    session.ts         /api/auth/me, /api/auth/logout
    progress.ts  users.ts  super-admin.ts  audit-notifications.ts
    questions.ts       categories, question bank, /api/questions
    seat-limits.ts  submissions-list.ts  admin-reports.ts  submissions-crud.ts
    surveys.ts  companies.ts  web-survey.ts  submissions-create.ts
    media.ts  geo.ts  analytics.ts  export.ts
  lib/                 helpers (db, http, cors, crypto, totp, apk, schema, users, verify, r2-media, facts, ...)
    analytics/         answers.ts, loader.ts, build.ts
```

Route order is preserved from the original if-chain. Blocks moved relative to each other only where paths are disjoint
(super-admin/soniox, companies, /api/questions). No route logic was edited.

Soniox import: `../../../lib/soniox.ts` style paths assume handler.ts sits where it did before (sibling of ../lib/).

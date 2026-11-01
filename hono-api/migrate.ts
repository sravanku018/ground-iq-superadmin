/**
 * Deploy-step migration: run schema migrations explicitly instead of on the
 * first request after a version bump.
 *
 *   deno run -A --env-file=/opt/smart-survey-x/.env ./migrate.ts
 */
import { ready } from "./legacy/handler/lib/schema.ts";

await ready();
console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "schema" }));
Deno.exit(0);

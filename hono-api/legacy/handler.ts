/**
 * Election Survey API — Hono (Deno Deploy + VPS service)
 * Entry point. The implementation lives in ./handler/ (see handler/README.md).
 *
 * Local test:
 *   export DATABASE_URL='postgresql://...'
 *   deno run -A --env handler.ts
 */
export { handleRequest } from "./handler/router.ts";
import { handleRequest } from "./handler/router.ts";

if (import.meta.main) {
  Deno.serve(async (req) => handleRequest(req));
}

import type { PortalUser } from "../lib/users.ts";

/** Per-request context handed to every route module. */
export type Ctx = {
  req: Request;
  url: URL;
  /** pathname with trailing slash removed ("/" for root) */
  path: string;
  method: string;
  /** alias of `method` (kept because many routes were written with `m`) */
  m: string;
  token: string | null;
  me: PortalUser | null;
  /** Re-run the router with a rewritten path/method/body (used by route aliases). */
  redispatch: (req: Request, pathAndQuery: string, method?: string, body?: string) => Promise<Response>;
};

import type { Context, Handler } from "hono";
import { handleRequest } from "../legacy/handler.ts";

/** Forward the original Request to the existing API handler. */
export function proxyLegacy(): Handler {
  return (c: Context) => handleRequest(c.req.raw);
}

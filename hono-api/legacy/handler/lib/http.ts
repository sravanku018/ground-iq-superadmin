import {
  CORS_HEADERS,
} from "./cors.ts";

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > 10_000_000) throw new Error("Body too large");
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Read a small JSON body with a real byte ceiling.
 *
 * `readBody` only checks Content-Length; a chunked request can still stream an
 * unbounded body into memory. Public endpoints (error reports, contact form)
 * must cap while reading. Throws on oversize so the route can answer 413.
 */
export async function readBodyLimited(
  req: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  const cl = Number(req.headers.get("content-length") || 0);
  if (cl > maxBytes) throw new Error("Body too large");
  if (!req.body) return {};

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => null);
        throw new Error("Body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock?.();
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const x = req.headers.get("x-auth-token");
  if (x) return x;
  return null; // Removed URL query token support for security
}


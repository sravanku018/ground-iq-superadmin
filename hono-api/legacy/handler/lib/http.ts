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

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const x = req.headers.get("x-auth-token");
  if (x) return x;
  return null; // Removed URL query token support for security
}


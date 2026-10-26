import {
  neon,
} from "npm:@neondatabase/serverless@0.10.4";
import postgres from "npm:postgres@3.4.9";

// ── Config ────────────────────────────────────────────────
export const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

/** Neon HTTP on Deploy; VPS PostgreSQL 18.6 (Smart Survey X). R2 stays Cloudflare.
 *  Keep these postgres() options in sync with db/client.ts. */
export function createSql(url: string | undefined) {
  if (!url) return null;
  if (url.includes("neon.tech") || url.includes("neon.cloud")) {
    // neon >= 1.0 throws NOT_TAGGED_CALL for sql("text", params); route string
    // calls through client.query() when it exists (older versions: direct call).
    const client = neon(url) as unknown as {
      (...args: unknown[]): Promise<unknown>;
      query?: (text: string, params: unknown[]) => Promise<unknown>;
    };
    const run = (first: TemplateStringsArray | string, ...rest: unknown[]) => {
      if (typeof first === "string") {
        const params = (Array.isArray(rest[0]) ? rest[0] : []) as unknown[];
        return typeof client.query === "function"
          ? client.query(first, params)
          : client(first, params);
      }
      return client(first, ...rest);
    };
    return run as unknown as ReturnType<typeof neon>;
  }
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 20,
    // postgres.js recycles connections every 60s by default — pointless
    // churn on the VPS where the DB is on localhost.
    max_lifetime: 300,
  });
  const run = (first: TemplateStringsArray | string, ...rest: unknown[]) => {
    if (typeof first === "string") {
      const params = (Array.isArray(rest[0]) ? rest[0] : []) as never[];
      return Promise.resolve(client.unsafe(first, params));
    }
    return client(first as TemplateStringsArray, ...rest);
  };
  (run as unknown as { json: typeof client.json }).json = client.json.bind(client);
  return run as ReturnType<typeof neon> & { json: typeof client.json };
}

// Export as non-null: the router already checks `if (!sql)` and returns 500.
// The type accepts both tagged templates (sql`...`) and string calls
// (sql("SELECT ...", [params])), matching the runtime behaviour above.
type SqlCallable = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  (text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};
export const sql = createSql(DATABASE_URL) as SqlCallable;

export function sqlJson(data: unknown) {
  let obj: unknown = data;
  while (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      break;
    }
  }
  if (sql && typeof (sql as unknown as { json?: (v: unknown) => unknown }).json === "function") {
    return (sql as unknown as { json: (v: unknown) => unknown }).json(obj);
  }
  return JSON.stringify(obj);
}

export async function insertSubmissionRow(payload: Record<string, unknown>) {
  const param = sqlJson(payload);
  // ON CONFLICT DO NOTHING against the client_package_id unique index: two
  // concurrent sync retries of the same package can never both insert. An
  // empty result means "already stored" — the caller returns the existing row.
  if (typeof param === "string") {
    return await sql`
      INSERT INTO submissions (payload)
      VALUES (${param}::jsonb)
      ON CONFLICT DO NOTHING
      RETURNING id, payload, created_at
    `;
  }
  return await sql`
    INSERT INTO submissions (payload)
    VALUES (${param})
    ON CONFLICT DO NOTHING
    RETURNING id, payload, created_at
  `;
}

export async function setSubmissionPayload(id: number, payload: Record<string, unknown>) {
  const param = sqlJson(payload);
  if (typeof param === "string") {
    await sql`UPDATE submissions SET payload = ${param}::jsonb WHERE id = ${id}`;
    return;
  }
  await sql`UPDATE submissions SET payload = ${param} WHERE id = ${id}`;
}

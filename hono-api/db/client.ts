import { neon } from "npm:@neondatabase/serverless@0.10.4";
import postgres from "npm:postgres@3.4.5";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

/** Neon on Deploy; VPS Postgres (database smart_survey_x) otherwise. */
export const sql = (() => {
  const url = DATABASE_URL;
  if (!url) return null;
  if (url.includes("neon.tech") || url.includes("neon.cloud")) return neon(url);
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 20 });
  const run = (first: TemplateStringsArray | string, ...rest: unknown[]) => {
    if (typeof first === "string") {
      const params = (Array.isArray(rest[0]) ? rest[0] : []) as never[];
      return Promise.resolve(client.unsafe(first, params));
    }
    return client(first as TemplateStringsArray, ...rest);
  };
  return run;
})();

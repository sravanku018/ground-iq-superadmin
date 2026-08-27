import { neon } from "npm:@neondatabase/serverless@0.10.4";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

/** Neon Postgres — same DATABASE_URL as the Playground deploy. */
export const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

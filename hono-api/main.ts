/**
 * Ground IQ API — Hono entry for Deno Deploy (GitHub auto-deploy).
 *
 * Existing endpoints still run through legacy/handler.ts (a copy of
 * deno-deploy/main.ts). That Playground file is not edited.
 *
 * Deno Deploy: set project root to `hono-api` (or entry `hono-api/main.ts`).
 */
import { Hono } from "hono";
import { handleRequest } from "./legacy/handler.ts";
import authRouter from "./routes/auth.ts";
import usersRouter from "./routes/users.ts";
import chatRouter from "./routes/chat.ts";
import surveysRouter from "./routes/surveys.ts";

export const app = new Hono();

app.route("/api/auth", authRouter);
app.route("/api/users", usersRouter);
app.route("/api/surveys", surveysRouter);
app.route("/api/chat", chatRouter);

app.all("*", (c) => handleRequest(c.req.raw));

if (import.meta.main) {
  Deno.serve(app.fetch);
}

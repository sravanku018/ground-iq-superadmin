import { Hono } from "hono";

const chat = new Hono();

chat.all("/*", (c) => c.json({ error: "Chat is not enabled" }, 404));
chat.all("/", (c) => c.json({ error: "Chat is not enabled" }, 404));

export default chat;

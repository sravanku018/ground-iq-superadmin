import { Hono } from "hono";
import { proxyLegacy } from "../lib/utils.ts";

const auth = new Hono();
const proxy = proxyLegacy();

auth.all("/", proxy);
auth.all("/*", proxy);

export default auth;

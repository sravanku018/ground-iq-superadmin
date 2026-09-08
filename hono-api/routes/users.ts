import { Hono } from "hono";
import { proxyLegacy } from "../lib/utils.ts";

const users = new Hono();
const proxy = proxyLegacy();

users.all("/", proxy);
users.all("/*", proxy);

export default users;

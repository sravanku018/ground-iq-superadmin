import { Hono } from "hono";
import { proxyLegacy } from "../lib/utils.ts";

const surveys = new Hono();
const proxy = proxyLegacy();

surveys.all("/", proxy);
surveys.all("/*", proxy);

export default surveys;

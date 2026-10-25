import type { Ctx } from "./ctx.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  GEO_ALIASES,
} from "../lib/geo-aliases.ts";
import {
  json,
} from "../lib/http.ts";

export async function handleGeo(c: Ctx): Promise<Response | null> {
  const { url, path, method, m, me } = c;
  // Minimal geo for cascading dropdowns (cached 1 day)
  if (path === "/api/geo" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    try {
      const acs = await sql`
          SELECT name AS constituency, covering_districts AS district,
                 mp_constituency AS "mpConstituency"
          FROM assembly_constituencies ORDER BY name
        `;
      const districtsRows = await sql`SELECT name FROM districts ORDER BY name`;
      const districtSet = new Set(districtsRows.map((d) => d.name));
      const constituencies = acs.map((r: Record<string, string>) => {
        const covering = String(r.district || "").split(",").map((s) => s.trim()).filter(Boolean);
        covering.forEach((d) => districtSet.add(d));
        return {
          constituency: r.constituency,
          district: covering[0] || "",
          coveringDistricts: covering,
          mpConstituency: String(r.mpConstituency || "").replace(/\s*\(.*?\)\s*$/, ""),
        };
      });
      return json({
        constituencies,
        districts: [...districtSet].sort(),
        mpConstituencies: [],
      }, 200, { "cache-control": "public, max-age=86400" });
    } catch {
      return json({ constituencies: [], districts: [], mpConstituencies: [] });
    }
  }

  // Combined geo children lists (mandals + revenue divisions for a district, cached 1 day)
  if (m === "GET" && url.pathname === "/api/geo/children") {
    if (!me) return json({ error: "Login required" }, 401);
    const raw = String(url.searchParams.get("district") || "").trim();
    const district = GEO_ALIASES.districts[raw.toLowerCase()] ?? raw;
    try {
      const mandals = district
        ? await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals WHERE district = ${district} ORDER BY mandal_name
            `
        : await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals ORDER BY district, mandal_name LIMIT 500
            `;
      const revenueDivisions = district
        ? await sql`SELECT name, district FROM revenue_divisions WHERE district = ${district} ORDER BY name LIMIT 200`
        : await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
      return json({
        district,
        mandals,
        divisions: revenueDivisions,
        revenueDivisions,
      }, 200, { "cache-control": "public, max-age=86400" });
    } catch {
      return json({ district, mandals: [], divisions: [], revenueDivisions: [] });
    }
  }

  if (path === "/api/geo/mandals" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const district = url.searchParams.get("district") || "";
    try {
      const rows = district
        ? await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals WHERE district = ${district} ORDER BY mandal_name
            `
        : await sql`
              SELECT mandal_name AS "mandalName", district,
                     revenue_division AS "revenueDivision", mandal_code AS "mandalCode"
              FROM mandals ORDER BY district, mandal_name LIMIT 500
            `;
      return json({ mandals: rows }, 200, { "cache-control": "public, max-age=86400" });
    } catch {
      return json({ mandals: [] });
    }
  }

  if (path === "/api/geo/revenue_divisions" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    try {
      const rows = await sql`SELECT name, district FROM revenue_divisions ORDER BY name LIMIT 200`;
      return json({ revenueDivisions: rows }, 200, { "cache-control": "public, max-age=86400" });
    } catch {
      return json({ revenueDivisions: [] });
    }
  }
  return null;
}

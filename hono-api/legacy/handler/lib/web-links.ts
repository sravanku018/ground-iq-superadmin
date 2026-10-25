import {
  randomBytes,
} from "node:crypto";
import {
  sql,
} from "./db.ts";
import {
  json,
} from "./http.ts";

export function newWebFillToken(): string {
  return randomBytes(18).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Public fill page — field Vercel app, survey name in the path, never Super Admin. */
export const CANONICAL_FIELD_APP = "https://www.smartsurveyx.com/";

export function publicWebFillUrl(formKey: string, token: string): string {
  const slug = String(formKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "";
  const u = new URL(`fill/${encodeURIComponent(slug)}`, CANONICAL_FIELD_APP);
  if (token) u.searchParams.set("k", token);
  return u.toString();
}

export function webLinkExpired(extra: Record<string, unknown> = {}) {
  return json(
    {
      error: "This link has expired. The allowed number of responses has been reached.",
      expired: true,
      ...extra,
    },
    410,
  );
}

export function clampWebLinkMaxUses(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 9999);
}

export function webLinkSpent(link: { used_at?: unknown; use_count?: unknown; max_uses?: unknown }): boolean {
  if (link.used_at) return true;
  const used = Math.max(0, Number(link.use_count) || 0);
  const max = clampWebLinkMaxUses(link.max_uses);
  return used >= max;
}

export type WebLinkRow = {
  token: string;
  form_key: string;
  max_uses: number;
  use_count: number;
  used_at: unknown;
  created_at: unknown;
  expired: boolean;
};

export function mapWebLinkRow(r: Record<string, unknown>): WebLinkRow {
  const max = clampWebLinkMaxUses(r.max_uses);
  const used = Math.max(0, Number(r.use_count) || 0);
  return {
    token: String(r.token || ""),
    form_key: String(r.form_key || ""),
    max_uses: max,
    use_count: used,
    used_at: r.used_at || null,
    created_at: r.created_at || null,
    expired: Boolean(r.used_at) || used >= max,
  };
}

/** Live (shareable) token for a survey — not deactivated and under cap. */
export async function findLiveWebLink(formKey: string): Promise<WebLinkRow | null> {
  if (!sql || !formKey) return null;
  const existing = await sql`
    SELECT token, form_key, max_uses, use_count, used_at, created_at
    FROM web_survey_links
    WHERE form_key = ${formKey}
      AND used_at IS NULL
      AND use_count < max_uses
    ORDER BY created_at ASC
    LIMIT 1
  `.catch(() => []);
  if (!existing.length) return null;
  return mapWebLinkRow(existing[0] as Record<string, unknown>);
}

export async function insertWebLink(
  formKey: string,
  createdBy: number,
  maxUses = 100,
): Promise<WebLinkRow | null> {
  if (!sql || !formKey) return null;
  const token = newWebFillToken();
  const cap = clampWebLinkMaxUses(maxUses);
  await sql`
    INSERT INTO web_survey_links (token, form_key, created_by, max_uses, use_count)
    VALUES (${token}, ${formKey}, ${createdBy}, ${cap}, 0)
  `;
  return {
    token,
    form_key: formKey,
    max_uses: cap,
    use_count: 0,
    used_at: null,
    created_at: new Date().toISOString(),
    expired: false,
  };
}

export async function surveyIsFrozen(
  sqlFn: NonNullable<typeof sql>,
  formKey: string,
  surveyId?: number | null,
): Promise<{ frozen: boolean; ended: boolean }> {
  if (!formKey) return { frozen: false, ended: false };
  const endedRows = await sqlFn`
    SELECT ended_at FROM survey_form WHERE form_key = ${formKey} LIMIT 1
  `.catch(() => []);
  const ended = Boolean((endedRows[0] as { ended_at?: unknown } | undefined)?.ended_at);
  if (ended) return { frozen: true, ended: true };
  const links = await sqlFn`
    SELECT token FROM web_survey_links WHERE form_key = ${formKey} LIMIT 1
  `.catch(() => []);
  if (links.length) return { frozen: true, ended: false };
  const subs = await sqlFn`
    SELECT id FROM submissions
    WHERE payload->>'form_key' = ${formKey}
      AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
      AND COALESCE(payload->'answers'->>'_draft', 'false') NOT IN ('true', 't', '1')
    LIMIT 1
  `.catch(() => []);
  if (subs.length) return { frozen: true, ended: false };
  if (surveyId) {
    const team = await sqlFn`
      SELECT 1 FROM survey_assignments WHERE survey_id = ${surveyId} LIMIT 1
    `.catch(() => []);
    if (team.length) return { frozen: true, ended: false };
  }
  return { frozen: false, ended: false };
}

export async function expireWebLinksForSurvey(formKey: string) {
  if (!sql || !formKey) return;
  await sql`
    UPDATE web_survey_links
    SET used_at = COALESCE(used_at, NOW())
    WHERE form_key = ${formKey}
      AND used_at IS NULL
  `.catch(() => null);
}

/** Live token if one exists; otherwise mint. Never remints after deactivate, end, or target. */
export async function ensureCanonicalWebLink(
  formKey: string,
  createdBy: number,
  maxUses = 100,
): Promise<WebLinkRow | null> {
  const live = await findLiveWebLink(formKey);
  if (live) return live;
  const closed = await sql`
    SELECT token, form_key, max_uses, use_count, used_at, created_at
    FROM web_survey_links
    WHERE form_key = ${formKey}
    ORDER BY created_at DESC
    LIMIT 1
  `.catch(() => []);
  if (closed.length) {
    return { ...mapWebLinkRow(closed[0] as Record<string, unknown>), expired: true };
  }
  return insertWebLink(formKey, createdBy, maxUses);
}


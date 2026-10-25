import {
  sql,
  sqlJson,
} from "./db.ts";
import {
  parsePayload,
} from "./payload.ts";
import {
  isDraftSubmission,
  payloadStatus,
  stripDraftFlags,
  surveyorNameOf,
  verifySubmission,
  voiceRequiredOf,
} from "./verify.ts";

/** Load + resolve all submissions into analytics rows (AC → district resolution, mandal fallback, party/gender/caste normalisation). Shared by analytics + export. */
// ── Fact materialization (Processing — 17-ANALYTICS-PROCESSING-SEQUENCE.md §1.2/§3) ──

/** Answer keys that are internal bookkeeping, never analytics facts. */
export const FACT_META_KEYS = new Set([
  "_draft", "draft", "_startedAt", "_lastQuestion", "_answeredCount", "_syncedAt",
  "_recordIndex", "recordIndex", "data_collector", "submitted_by", "notes",
  // geo-ish / media-ish keys are bookkeeping — geo lives on record_facts.geo instead
  "latitude", "longitude", "lat", "lng", "geo_lat", "geo_lng", "gps_lat", "gps_lng",
]);

/** Normalize an answer value into its fact-safe form (09-ANALYTICS-SPEC §2.1). */
export function normalizeFactValue(v: unknown): unknown {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].sort();
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (Number.isFinite(Number(s)) && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Narrow fact payload: only real answer keys (metadata/media excluded) — keeps the table lean. */
export function buildFilterableAnswers(payload: Record<string, unknown>): Record<string, unknown> {
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (FACT_META_KEYS.has(k)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue; // no nested blobs in facts
    const norm = normalizeFactValue(v);
    if (norm !== null && norm !== undefined && !(Array.isArray(norm) && norm.length === 0)) {
      out[k] = norm;
    }
  }
  return out;
}

/**
 * Insert one record_facts row for a confirmed submission. Idempotent
 * (ON CONFLICT DO NOTHING). On unexpected error the record is flagged
 * fact_status='failed' for manual retry — the confirm decision is never lost.
 */
export async function materializeFact(
  sqlFn: NonNullable<typeof sql>,
  submissionId: number,
): Promise<{ inserted: boolean; already_existed: boolean }> {
  const rows = await sqlFn`SELECT id, payload FROM submissions WHERE id = ${submissionId}`;
  if (!rows.length) throw new Error("submission not found");
  const payload = parsePayload((rows[0] as { payload: unknown }).payload);
  if (payloadStatus(payload) !== "confirmed") {
    throw new Error("record is not confirmed — facts are only materialized for confirmed records");
  }
  const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
  const surveyKey = String(payload.form_key || payload.formKey || "default");
  const confirmedAt = String(payload.confirmed_at || new Date().toISOString());
  const geo = (payload.geo as Record<string, unknown> | undefined) || null;
  const filterable = buildFilterableAnswers(payload);

  const inserted = await sqlFn`
    INSERT INTO record_facts (
      submission_id, survey_key, submitted_by, district, constituency,
      filterable_answers, geo, confirmed_at, fact_status
    ) VALUES (
      ${submissionId}, ${surveyKey}, ${surveyorNameOf(payload)},
      ${String(answers.district || "").trim()}, ${String(answers.constituency || "").trim()},
      ${sqlJson(filterable)}, ${geo ? sqlJson(geo) : null},
      ${confirmedAt}::timestamptz, 'materialized'
    )
    ON CONFLICT (submission_id) DO NOTHING
    RETURNING submission_id
  `;
  await sqlFn`
    UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ${submissionId}
  `.catch(() => null);
  return {
    inserted: inserted.length > 0,
    already_existed: inserted.length === 0,
  };
}

/** Flag a record so Review surfaces it and retry-fact can re-run materialization. */
export async function markFactFailed(sqlFn: NonNullable<typeof sql>, id: number, err: unknown) {
  const msg = String((err as Error)?.message || err || "unknown error").slice(0, 500);
  await sqlFn`UPDATE submissions SET fact_status = 'failed', fact_error = ${msg} WHERE id = ${id}`.catch(() => null);
}

/**
 * Completeness bookkeeping only. Client Admin confirms in Review QA —
 * field sync must not auto-confirm (wrong clock + skips review).
 */
export async function autoConfirmIfComplete(
  sqlFn: NonNullable<typeof sql>,
  submissionId: number,
): Promise<{ auto_confirmed: boolean; completeness: string }> {
  const rows = await sqlFn`
    SELECT id, payload FROM submissions WHERE id = ${submissionId} LIMIT 1
  `.catch(() => []);
  if (!rows.length) return { auto_confirmed: false, completeness: "incomplete" };

  const rawPayload = parsePayload((rows[0] as { payload: unknown }).payload);
  let payload = stripDraftFlags(rawPayload);
  const cur = payloadStatus(payload);

  if (isDraftSubmission(rawPayload)) {
    await sqlFn`
      UPDATE submissions SET payload = ${sqlJson(payload)} WHERE id = ${submissionId}
    `.catch(() => null);
  }

  if (cur === "confirmed") return { auto_confirmed: false, completeness: "complete" };
  if (cur === "rejected") return { auto_confirmed: false, completeness: "incomplete" };

  const mediaKinds = (
    await sqlFn`SELECT kind FROM survey_media WHERE submission_id = ${submissionId}`.catch(() => [])
  ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
  if (mediaKinds.includes("audio")) payload.has_audio = true;
  if (mediaKinds.includes("photo")) payload.has_photo = true;

  const formKey = String(payload.form_key || "").trim();
  let voiceReq = voiceRequiredOf(payload);
  if (formKey) {
    const vr = await sqlFn`
      SELECT voice_required FROM survey_form WHERE form_key = ${formKey} LIMIT 1
    `.catch(() => []);
    if (vr.length) {
      voiceReq = (vr[0] as { voice_required?: boolean }).voice_required === true;
      payload.voice_required = voiceReq;
    }
  }

  const verify = verifySubmission(payload, mediaKinds, voiceReq);
  payload = {
    ...payload,
    completeness: verify.completeness,
    verification: verify,
    has_audio: mediaKinds.includes("audio") || payload.has_audio === true,
    has_photo: verify.photo_ok ? true : payload.has_photo,
    status: cur === "pending" ? "pending" : cur,
  };
  await sqlFn`
    UPDATE submissions SET payload = ${sqlJson(payload)} WHERE id = ${submissionId}
  `.catch(() => null);
  return { auto_confirmed: false, completeness: verify.completeness };
}

/**
 * Idempotent fact catch-up for confirmed submissions without a fact row.
 * Batched multi-row INSERTs — never one query per row — so even thousands of
 * legacy rows complete in a handful of round trips (boot/first-request safe).
 */
export async function backfillFacts(
  sqlFn: NonNullable<typeof sql>,
  opts: { limit?: number } = {},
): Promise<{ materialized: number; failed: number }> {
  const limit = opts.limit ?? 10000;
  const rows = await sqlFn`
    SELECT s.id, s.payload FROM submissions s
    WHERE s.payload->>'status' = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM record_facts f WHERE f.submission_id = s.id)
    ORDER BY s.id
    LIMIT ${limit}
  `.catch(() => []);
  if (!rows.length) return { materialized: 0, failed: 0 };

  const rawSql = sqlFn as unknown as (text: string, params: unknown[]) => Promise<unknown[]>;
  const BATCH = 200;
  const COLS = 9; // submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status
  let materialized = 0;
  const failedIds: number[] = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = (rows as { id: number; payload: unknown }[]).slice(i, i + BATCH);
    const valueRows: unknown[][] = [];
    for (const r of chunk) {
      try {
        const payload = parsePayload(r.payload);
        if (payloadStatus(payload) !== "confirmed") continue;
        const answers = ((payload.answers as Record<string, unknown>) || payload) as Record<string, unknown>;
        // Guard against malformed confirmed_at poisoning the whole batch
        const confirmedAt = (() => {
          const ts = String(payload.confirmed_at || "");
          return ts && !Number.isNaN(Date.parse(ts)) ? ts : new Date().toISOString();
        })();
        valueRows.push([
          Number(r.id),
          String(payload.form_key || payload.formKey || "default"),
          surveyorNameOf(payload),
          String(answers.district || "").trim(),
          String(answers.constituency || "").trim(),
          JSON.stringify(buildFilterableAnswers(payload)),
          payload.geo ? JSON.stringify(payload.geo) : null,
          confirmedAt,
          "materialized",
        ]);
      } catch {
        failedIds.push(Number(r.id));
      }
    }
    if (!valueRows.length) continue;
    const placeholders = valueRows
      .map((_, r) =>
        `(${Array.from({ length: COLS }, (_, c) => `$${r * COLS + c + 1}`).join(", ")})`,
      )
      .join(", ");
    try {
      await rawSql(
        `INSERT INTO record_facts (submission_id, survey_key, submitted_by, district, constituency, filterable_answers, geo, confirmed_at, fact_status)
         VALUES ${placeholders}
         ON CONFLICT (submission_id) DO NOTHING`,
        valueRows.flat(),
      );
      materialized += valueRows.length;
      await sqlFn`UPDATE submissions SET fact_status = 'materialized', fact_error = NULL WHERE id = ANY(${valueRows.map((v) => v[0])})`.catch(() => null);
    } catch {
      for (const r of chunk) failedIds.push(Number(r.id));
    }
  }

  for (const id of failedIds) {
    await markFactFailed(sqlFn, id, new Error("fact backfill failed"));
  }
  return { materialized, failed: failedIds.length };
}


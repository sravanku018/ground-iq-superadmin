import {
  sql,
} from "./db.ts";

export type Row = {
  id: string | number;
  created_at: string;
  district: string;
  constituency: string;
  party: string;
  gender: string;
  caste: string;
  pm: string;
  performance: string;
  education: string;
  employment: string;
  age: string;
  mp: string;
  issues: string[];
  status: string;
  completeness: string;
  geo_ok: boolean;
  voice_ok: boolean;
  submitted_by: string;
  respondent: string;
  formKey: string;
  source: string;
  answers: Record<string, unknown>;
};

/** Report status: pending → confirmed (analytics) | rejected */
export function payloadStatus(payload: Record<string, unknown>): string {
  const s = String(payload?.status || "").toLowerCase().trim();
  if (s === "confirmed" || s === "rejected" || s === "pending") return s;
  // legacy rows without status: pending until admin confirms
  return "pending";
}

/** Keys that are locks/geo metadata, not real survey answers */
export function isMetaAnswerKey(k: string): boolean {
  const s = String(k || "").toLowerCase();
  if (!s || s.startsWith("_")) return true;
  if (s.startsWith("geo_") || s.startsWith("location_")) return true;
  if (s.startsWith("ts_") || s.startsWith("sec_")) return true;
  if (s === "answer_pattern") return true;
  return (
    s === "lat" ||
    s === "lng" ||
    s === "latitude" ||
    s === "longitude" ||
    s === "accuracy" ||
    s === "data_collector" ||
    s === "client_package_id" ||
    s === "surveyor" ||
    s === "agent"
  );
}

/**
 * Resolve surveyor display name from payload + answers (never invent from respondent).
 */
export function surveyorNameOf(payload: Record<string, unknown>): string {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  const name = String(
    payload?.submitted_by ||
      a.data_collector ||
      a.surveyor ||
      a.agent ||
      "",
  ).trim();
  return name || "unknown";
}

/**
 * Field drafts are not finished work. Even if status was wrongly set to
 * confirmed, keep them out of "completed" and count under pending.
 * Example Anumula1: 3 status=pending + 1 confirmed-with-_draft → 4 pending, 6 completed.
 */
export function isDraftSubmission(payload: Record<string, unknown>): boolean {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  return (
    payload?.draft === true ||
    a._draft === true ||
    a.draft === true ||
    String(payload?.content_type || "").toLowerCase() === "draft"
  );
}

/** Field Send / POST must not keep phone-only draft markers on the server row. */
export function stripDraftFlags(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload, draft: false };
  const ans = { ...((next.answers || {}) as Record<string, unknown>) };
  delete ans._draft;
  delete ans.draft;
  next.answers = ans;
  if (String(next.content_type || "").toLowerCase() === "draft") next.content_type = "qa";
  return next;
}

/** Field record number (1, 2, 3…) — not the database id. */
export function recordIndexOf(payload: Record<string, unknown>): number | null {
  const a = (payload?.answers || {}) as Record<string, unknown>;
  const n = Number(
    payload?.record_index ??
      payload?.recordIndex ??
      a._recordIndex ??
      a.recordIndex,
  );
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}


/**
 * Surveyor work status for Report boards:
 * - completed = Client Admin confirmed AND not a draft
 * - pending   = still open (status pending/rejected OR still tagged draft)
 */
export function workStatusOf(
  payload: Record<string, unknown>,
): "completed" | "pending" | "rejected" {
  const status = payloadStatus(payload);
  const draft = isDraftSubmission(payload);
  if (draft) return "pending";
  if (status === "confirmed") return "completed";
  if (status === "rejected") return "rejected";
  return "pending";
}

/**
 * Strict verification: geo + photo + Q/A. Voice is required only when the
 * Client Admin marked the survey voice_required — optional by default.
 * Incomplete cannot enter confirmed analytics without override.
 *
 * LEGACY rows (collected before GPS/camera existed — no geo and never any
 * media) are exempt: they are not subject to the geo/voice/photo checks, so
 * old data can be confirmed and reported normally. Only at least one answer
 * is required.
 */
export function verifySubmission(
  payload: Record<string, unknown>,
  mediaKinds: string[] = [],
  voiceRequired = false,
) {
  const answers = (payload?.answers || {}) as Record<string, unknown>;
  const geoPayload = (payload?.geo || null) as Record<string, unknown> | null;
  // Fallback: some clients store coords only under answers.geo_lat / geo_lng
  const lat = Number(
    geoPayload != null
      ? (geoPayload.lat ?? geoPayload.latitude)
      : (answers.geo_lat ?? answers.latitude ?? answers.lat ?? NaN),
  );
  const lng = Number(
    geoPayload != null
      ? (geoPayload.lng ?? geoPayload.longitude)
      : (answers.geo_lng ?? answers.longitude ?? answers.lng ?? NaN),
  );
  const accuracyRaw =
    geoPayload != null && geoPayload.accuracy != null
      ? Number(geoPayload.accuracy)
      : answers.geo_accuracy != null
      ? Number(answers.geo_accuracy)
      : null;
  const accuracy = accuracyRaw != null && Number.isFinite(accuracyRaw)
    ? accuracyRaw
    : null;
  const hasGeoObject = geoPayload != null ||
    (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0));

  const geo_ok =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0);

  const kinds = (mediaKinds || []).map((k) => String(k || "").toLowerCase());
  const src = String(payload?.source || "").toLowerCase();
  const locks = (payload?.locks && typeof payload.locks === "object")
    ? (payload.locks as Record<string, unknown>)
    : {};
  const isWebFill = src === "web-survey" || src === "web" || locks.web === true;

  // URL / media-id on payload also count (R2 or free Neon links may not re-set flags)
  const hasPhotoUrl = Boolean(
    payload?.photo_url ||
      payload?.photo_media_id ||
      payload?.photoUrl ||
      payload?.photoMediaId,
  );
  const hasAudioUrl = Boolean(
    payload?.audio_url ||
      payload?.audio_media_id ||
      payload?.audioUrl ||
      payload?.audioMediaId,
  );

  // Legacy = pre GPS/camera data: no geo ever attached AND no media/flags/urls.
  // (New submissions always carry geo — the server requires it on POST.)
  const legacy =
    !hasGeoObject &&
    kinds.length === 0 &&
    payload?.has_photo !== true &&
    payload?.has_audio !== true &&
    !hasPhotoUrl &&
    !hasAudioUrl;

  // Voice: required only when Client Admin set the survey to mandatory.
  const hasAudioFlag = payload?.has_audio === true;
  const hasAudioMedia = kinds.includes("audio");
  const hasVoice = hasAudioFlag || hasAudioMedia || hasAudioUrl;
  const voice_ok = legacy || !voiceRequired || hasVoice;

  const hasPhotoFlag = payload?.has_photo === true;
  const hasPhotoMedia = kinds.includes("photo");
  const photo_ok = legacy || hasPhotoFlag || hasPhotoMedia || hasPhotoUrl;

  // Real Q/A only — ignore lock flags / geo metadata stuffed into answers
  const answerKeys = Object.keys(answers).filter((k) => {
    if (isMetaAnswerKey(k)) return false;
    const v = answers[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== "";
  });
  const qa_ok = answerKeys.length >= 1;

  const failures: string[] = [];
  if (!legacy && !isWebFill) {
    if (!geo_ok) failures.push("geo_missing_or_invalid");
    if (voiceRequired && !voice_ok) failures.push("voice_missing");
    if (!photo_ok) failures.push("photo_missing");
  }
  if (!qa_ok) failures.push("qa_empty");

  // Web fill has no GPS/photo/voice by design. Strict complete = geo + photo + Q/A for field.
  const completeness: "complete" | "incomplete" = (legacy || isWebFill)
    ? qa_ok
      ? "complete"
      : "incomplete"
    : geo_ok && photo_ok && qa_ok && (!voiceRequired || voice_ok)
    ? "complete"
    : "incomplete";

  return {
    completeness,
    legacy,
    geo_ok: legacy || isWebFill ? true : geo_ok,
    web_fill: isWebFill,
    voice_ok: isWebFill ? true : voice_ok,
    photo_ok: isWebFill ? true : photo_ok,
    qa_ok,
    geo: geo_ok
      ? {
          lat,
          lng,
          accuracy,
          at: geoPayload?.at || answers.geo_at || null,
        }
      : geoPayload
      ? { lat: geoPayload.lat, lng: geoPayload.lng, invalid: true }
      : null,
    failures,
    checks: legacy || isWebFill
      ? {
          geo_tagging: "n/a",
          voice_detection: "n/a",
          photo: "n/a",
          qa: qa_ok ? "pass" : "fail",
        }
      : {
          geo_tagging: geo_ok ? "pass" : "fail",
          voice_detection: voice_ok ? "pass" : "fail",
          photo: photo_ok ? "pass" : "fail",
          qa: qa_ok ? "pass" : "fail",
        },
  };
}

/** Load submission_id → media kinds from survey_media (always Number keys). */
export async function loadMediaKindsMap(
  sqlFn: NonNullable<typeof sql>,
): Promise<Map<number, string[]>> {
  const mediaMap = new Map<number, string[]>();
  const mediaRows = await sqlFn`
    SELECT submission_id, kind FROM survey_media
  `.catch(() => []);
  for (const m of mediaRows as { submission_id: number; kind: string }[]) {
    const sid = Number(m.submission_id);
    if (!Number.isFinite(sid)) continue;
    const kind = String(m.kind || "").toLowerCase();
    if (!kind) continue;
    const arr = mediaMap.get(sid) || [];
    arr.push(kind);
    mediaMap.set(sid, arr);
  }
  return mediaMap;
}

/** Apply media kinds onto payload flags then verify (single source of truth). */
export function voiceRequiredOf(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (payload.voice_required === true) return true;
  const a = payload.answers as Record<string, unknown> | undefined;
  return a?._voice_required === true;
}

export function verifyWithMedia(
  payload: Record<string, unknown> | null | undefined,
  mediaMap: Map<number, string[]>,
  id: number | string,
) {
  const p: Record<string, unknown> =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const kinds = mediaMap.get(Number(id)) || [];
  if (kinds.includes("audio")) p.has_audio = true;
  if (kinds.includes("photo")) p.has_photo = true;
  return verifySubmission(p, kinds, voiceRequiredOf(p));
}


import type { Ctx } from "./ctx.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  setSubmissionPayload,
  sql,
  sqlJson,
} from "../lib/db.ts";
import {
  markFactFailed,
  materializeFact,
} from "../lib/facts.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  translateGeoEnglish,
} from "../lib/i18n-te.ts";
import {
  parsePayload,
} from "../lib/payload.ts";
import {
  hasPower,
} from "../lib/survey-assignments.ts";
import {
  adminFormKeyScope,
} from "../lib/tenant.ts";
import {
  qaFromAnswers,
} from "../lib/time.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";
import {
  loadMediaKindsMap,
  payloadStatus,
  surveyorNameOf,
  verifySubmission,
  verifyWithMedia,
  voiceRequiredOf,
} from "../lib/verify.ts";

export async function handleSubmissionsCrud(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  // Client Admin: get one submission (full payload for edit)
  if (path.match(/^\/api\/submissions\/\d+$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`
            SELECT id, payload, created_at FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})
          `
      : await sql`
            SELECT id, payload, created_at FROM submissions WHERE id = ${id}
          `;
    if (!rows.length) return json({ error: "Not found" }, 404);
    const r = rows[0] as { id: number; payload: unknown; created_at: string };
    const payload = parsePayload(r.payload);
    const answers = (payload.answers || {}) as Record<string, unknown>;
    const mediaKinds = (
      await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
    ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
    if (mediaKinds.includes("audio")) payload.has_audio = true;
    if (mediaKinds.includes("photo")) payload.has_photo = true;
    const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));
    const surveyor = surveyorNameOf(payload);
    return json({
      id: r.id,
      created_at: r.created_at,
      status: payloadStatus(payload),
      completeness: verify.completeness,
      verification: verify,
      legacy: !!verify.legacy,
      submitted_by: surveyor === "unknown" ? "" : surveyor,
      user_id: payload.user_id ?? null,
      source: payload.source || "app",
      form_id: payload.form_id || "",
      geo: payload.geo || verify.geo || null,
      has_audio: verify.voice_ok && !verify.legacy ? true : !!payload.has_audio,
      has_photo: verify.photo_ok && !verify.legacy ? true : !!payload.has_photo,
      answers,
      qa: qaFromAnswers(answers),
      voice_transcript: String(
        payload.voice_transcript || answers._voice_transcript_en || "",
      ),
      edit_history: Array.isArray(payload.edit_history)
        ? payload.edit_history
        : [],
      confirmed_at: payload.confirmed_at || null,
      confirmed_by: payload.confirmed_by || null,
      proof_validated: payload.proof_validated || null,
    });
  }

  // Client Admin: EDIT survey data (answers, surveyor, geo, status)
  if (path.match(/^\/api\/submissions\/\d+$/) && method === "PATCH") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_review_data")) {
      return json({
        error: "Super Admin has not granted your account data-verification rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
      : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
    if (!rows.length) return json({ error: "Not found" }, 404);

    let payload = parsePayload(rows[0].payload);
    const prevAnswers = {
      ...((payload.answers || {}) as Record<string, unknown>),
    };
    const changed: string[] = [];

    // Merge answer fields (partial update)
    if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
      const nextAns = {
        ...prevAnswers,
        ...(body.answers as Record<string, unknown>),
      };
      // Drop empty-string keys only if client sent null to clear? Keep empties as ""
      for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
        if (v === null || v === undefined) {
          delete nextAns[k];
          if (prevAnswers[k] != null) changed.push(`answers.${k}`);
        } else if (String(prevAnswers[k] ?? "") !== String(v)) {
          changed.push(`answers.${k}`);
        }
      }
      payload.answers = nextAns;
    }

    if (body.submitted_by != null && String(body.submitted_by).trim()) {
      const sb = String(body.submitted_by).trim();
      if (String(payload.submitted_by || "") !== sb) {
        changed.push("submitted_by");
        payload.submitted_by = sb;
      }
      const ans = (payload.answers || {}) as Record<string, unknown>;
      ans.data_collector = sb;
      payload.answers = ans;
    }

    // Optional geo fix by Client Admin
    if (body.geo && typeof body.geo === "object") {
      const g = body.geo as Record<string, unknown>;
      const lat = Number(g.lat ?? g.latitude);
      const lng = Number(g.lng ?? g.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        payload.geo = {
          lat,
          lng,
          accuracy: g.accuracy != null ? Number(g.accuracy) : null,
          at: g.at || new Date().toISOString(),
          source: "admin_edit",
        };
        changed.push("geo");
      }
    }

    // Media flags override (admin may mark present after offline repair)
    if (body.has_audio === true) {
      payload.has_audio = true;
      changed.push("has_audio");
    }
    if (body.has_photo === true) {
      payload.has_photo = true;
      changed.push("has_photo");
    }
    if (body.has_audio === false) {
      payload.has_audio = false;
      changed.push("has_audio");
    }
    if (body.has_photo === false) {
      payload.has_photo = false;
      changed.push("has_photo");
    }

    const mediaKinds = (
      await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
    ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
    if (mediaKinds.includes("audio")) payload.has_audio = true;
    if (mediaKinds.includes("photo")) payload.has_photo = true;

    const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));
    payload.completeness = verify.completeness;
    payload.verification = verify;

    // Optional status change in same edit
    if (body.status != null && String(body.status).trim()) {
      const next = String(body.status).toLowerCase().trim();
      if (!["confirmed", "rejected", "pending"].includes(next)) {
        return json({ error: "status must be confirmed | rejected | pending" }, 400);
      }
      const force = body.force === true;
      if (next === "confirmed" && verify.completeness !== "complete" && !force) {
        return json({
          error: "Strict verification failed — cannot confirm incomplete record",
          completeness: "incomplete",
          verification: verify,
          hint: "Fix answers/geo/voice/photo first, or pass force:true.",
        }, 422);
      }
      if (payloadStatus(payload) !== next) changed.push("status");
      if (next === "confirmed") payload = translateGeoEnglish(payload);
      payload.status = next;
      payload.confirmed_at = next === "pending" ? null : new Date().toISOString();
      payload.confirmed_by = next === "pending" ? null : me.name || me.username;
      payload.confirm_note = body.note || payload.confirm_note || null;
      if (next === "confirmed" && force) payload.force_confirm = true;
    }

    if (!changed.length && body.answers == null && body.geo == null && body.status == null) {
      return json({ error: "Nothing to update — send answers, geo, submitted_by, or status" }, 400);
    }

    const history = Array.isArray(payload.edit_history)
      ? [...(payload.edit_history as unknown[])]
      : [];
    history.unshift({
      at: new Date().toISOString(),
      by: me.name || me.username,
      fields: changed.length ? changed : ["answers"],
      note: body.note ? String(body.note).slice(0, 500) : null,
    });
    payload.edit_history = history.slice(0, 50);
    payload.updated_at = new Date().toISOString();
    payload.updated_by = me.name || me.username;

    await setSubmissionPayload(id, payload);

    // Fact layer: keep facts in sync when status is edited from the edit screen
    // (guard mirrors the status-change block above — empty status must not touch facts)
    if (body.status != null && String(body.status).trim()) {
      const s2 = String(body.status).toLowerCase().trim();
      if (s2 === "confirmed") {
        try {
          await materializeFact(sql, id);
        } catch (e) {
          await markFactFailed(sql, id, e);
        }
      } else {
        await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
        await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
      }
    }

    const answers = (payload.answers || {}) as Record<string, unknown>;
    return json({
      ok: true,
      id,
      status: payloadStatus(payload),
      completeness: verify.completeness,
      verification: verify,
      submitted_by: payload.submitted_by || answers.data_collector || "",
      answers,
      qa: qaFromAnswers(answers),
      voice_transcript: String(
        payload.voice_transcript || answers._voice_transcript_en || "",
      ),
      changed,
      updated_by: payload.updated_by,
      updated_at: payload.updated_at,
    });
  }

  // Client Admin / Super Admin: DELETE survey record
  if (path.match(/^\/api\/submissions\/\d+$/) && method === "DELETE") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_review_data")) {
      return json({
        error: "Super Admin has not granted your account data-verification rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
      : await sql`SELECT id FROM submissions WHERE id = ${id}`;
    if (!rows.length) return json({ error: "Not found" }, 404);
    // Older DBs may lack ON DELETE CASCADE on record_facts — delete children first
    // or Client Admin Analyze/Overview keeps showing the row after Super Admin delete.
    await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
    await sql`DELETE FROM survey_media WHERE submission_id = ${id}`.catch(() => null);
    await sql`UPDATE survey_respondents SET submission_id = NULL WHERE submission_id = ${id}`.catch(() => null);
    await sql`DELETE FROM submissions WHERE id = ${id}`;
    logAudit(me, "submission_delete", "submission", id, {});
    return json({
      ok: true,
      id,
      deleted: true,
      deleted_by: me.name || me.username,
    });
  }

  // Confirm / reject — strict: complete only (unless force)
  if (path.match(/^\/api\/submissions\/\d+\/status$/) && method === "PATCH") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_review_data")) {
      return json({
        error: "Super Admin has not granted your account data-verification rights",
      }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const next = String(body.status || "").toLowerCase();
    const force = body.force === true;
    if (!["confirmed", "rejected", "pending"].includes(next)) {
      return json({ error: "status must be confirmed | rejected | pending" }, 400);
    }
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
      : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
    if (!rows.length) return json({ error: "Not found" }, 404);
    let payload = parsePayload(rows[0].payload);
    const isWeb = payload.source === "web-survey" || payload.source === "web";
    if (isWeb && !hasPower(me, "can_web_survey")) {
      return json({
        error: "Super Admin has not granted Web survey permissions for this account",
      }, 403);
    }
    const mediaKinds = (
      await sql`SELECT kind FROM survey_media WHERE submission_id = ${id}`.catch(() => [])
    ).map((m) => String((m as { kind?: string }).kind || "").toLowerCase());
    if (mediaKinds.includes("audio")) payload.has_audio = true;
    if (mediaKinds.includes("photo")) payload.has_photo = true;
    const verify = verifySubmission(payload, mediaKinds, voiceRequiredOf(payload));

    if (next === "confirmed" && verify.completeness !== "complete" && !force) {
      return json({
        error: "Strict verification failed — cannot confirm incomplete record",
        completeness: "incomplete",
        verification: verify,
        hint: "Needs valid geo tag + voice (audio) + photo + Q/A. Pass force:true only if Client Admin overrides.",
      }, 422);
    }

    if (next === "confirmed") payload = translateGeoEnglish(payload);

    // Confirming a final survey clears draft tags so it counts as completed work
    if (next === "confirmed") {
      payload.draft = false;
      const ans = { ...((payload.answers || {}) as Record<string, unknown>) };
      delete ans._draft;
      delete ans.draft;
      payload.answers = ans;
    }

    payload = {
      ...payload,
      status: next,
      completeness: verify.completeness,
      verification: verify,
      has_audio: verify.voice_ok ? true : payload.has_audio,
      has_photo: verify.photo_ok ? true : payload.has_photo,
      confirmed_at: next === "pending" ? null : new Date().toISOString(),
      confirmed_by: next === "pending" ? null : me.name || me.username,
      confirm_note: body.note || null,
      force_confirm: next === "confirmed" && force ? true : undefined,
    };
    await setSubmissionPayload(id, payload);

    // Fact layer: confirmed → materialize (idempotent); pending/rejected → never in analytics
    if (next === "confirmed") {
      try {
        await materializeFact(sql, id);
      } catch (e) {
        await markFactFailed(sql, id, e);
      }
    } else {
      await sql`DELETE FROM record_facts WHERE submission_id = ${id}`.catch(() => null);
      await sql`UPDATE submissions SET fact_status = NULL, fact_error = NULL WHERE id = ${id}`.catch(() => null);
    }

    logAudit(me, "submission_status", "submission", id, { status: next, force });
    return json({
      ok: true,
      id,
      status: next,
      completeness: verify.completeness,
      verification: verify,
      confirmed_by: payload.confirmed_by,
      confirmed_at: payload.confirmed_at,
    });
  }



  // Bulk confirm all pending (bootstrap / after review)
  if (path === "/api/submissions/confirm-pending" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_review_data")) {
      return json({
        error: "Super Admin has not granted your account data-verification rights",
      }, 403);
    }
    const body = await readBody(req);
    const max = Math.min(Number(body.limit) || 500, 2000);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const rows = scopeKeys
      ? await sql`
            SELECT id, payload FROM submissions
            WHERE payload->>'form_key' = ANY(${scopeKeys})
            ORDER BY created_at DESC LIMIT ${max}
          `
      : await sql`
            SELECT id, payload FROM submissions ORDER BY created_at DESC LIMIT ${max}
          `;
    let n = 0;
    let skipped = 0;
    const who = me.name || me.username;
    const when = new Date().toISOString();
    const mediaMap = await loadMediaKindsMap(sql);
    for (const r of rows as { id: number; payload: Record<string, unknown> }[]) {
      let payload = r.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      if (payloadStatus(payload) !== "pending") continue;
      const isWeb = payload.source === "web-survey" || payload.source === "web";
      if (isWeb && !hasPower(me, "can_web_survey")) continue;

      // Completeness gate — skip incomplete records (matches single-confirm)
      const verify = verifyWithMedia(payload, mediaMap, r.id);
      if (verify.completeness !== "complete") {
        skipped += 1;
        continue;
      }

      payload = translateGeoEnglish(payload);

      // FIX: Strip draft flags before confirming, mirroring single-confirm logic
      payload.draft = false;
      const ans = { ...((payload.answers || {}) as Record<string, unknown>) };
      delete ans._draft;
      delete ans.draft;
      payload.answers = ans;

      payload = {
        ...payload,
        status: "confirmed",
        confirmed_at: when,
        confirmed_by: who,
        confirm_note: body.note || "bulk confirm",
      };
      await sql`
          UPDATE submissions SET payload = ${sqlJson(payload)} WHERE id = ${r.id}
        `;
      try {
        await materializeFact(sql, r.id);
      } catch (e) {
        await markFactFailed(sql, r.id, e);
      }
      n += 1;
    }
    return json({ ok: true, confirmed: n, skipped });
  }

  // Client Admin: retry fact materialization for a failed record (FR-PRC-04)
  if (path.match(/^\/api\/submissions\/\d+\/retry-fact$/) && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    const id = Number(path.split("/")[3]);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const row = scopeKeys
      ? await sql`SELECT id FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
      : await sql`SELECT id FROM submissions WHERE id = ${id}`;
    if (!row.length) return json({ error: "Not found" }, 404);
    try {
      const res = await materializeFact(sql, id);
      return json({ ok: true, ...res, status: "materialized" });
    } catch (e) {
      await markFactFailed(sql, id, e);
      return json({
        ok: false,
        error: "Fact materialization failed",
        detail: String((e as Error)?.message || e),
      }, 422);
    }
  }
  return null;
}

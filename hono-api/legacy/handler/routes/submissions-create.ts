import type { Ctx } from "./ctx.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  insertSubmissionRow,
  sql,
} from "../lib/db.ts";
import {
  stripPii,
} from "../lib/defaults.ts";
import {
  autoConfirmIfComplete,
} from "../lib/facts.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  adminFormKeyScope,
  countTenantRecords,
} from "../lib/tenant.ts";
import {
  isPortalAdmin,
  sqlCountN,
} from "../lib/users.ts";
import {
  stripDraftFlags,
} from "../lib/verify.ts";

export async function handleSubmissionsCreate(c: Ctx): Promise<Response | null> {
  const { req, path, method, me } = c;
  if (path === "/api/submissions" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role) && me.role !== "surveyor") {
      return json({ error: "Login required as admin, super admin, or surveyor" }, 403);
    }
    const body = await readBody(req);
    const incomingSource = String(body.source || "");
    if (incomingSource === "web-survey" || incomingSource === "web") {
      return json({
        error: "Web surveys can only be submitted by respondents via public survey links, not from inside the app/portal.",
      }, 403);
    }
    // Q/A only — media uploaded separately to /api/submissions/:id/media
    const answers = (body.answers || body) as Record<string, unknown>;
    const geo = body.geo || null;
    const agent =
      String(body.submitted_by || "").trim() || me.name || me.username;

    // Super-Admin-set max_records on Client Admin profile (tenant-wide field records)
    if (me.role === "surveyor" || me.role === "admin") {
      let ownerId = Number(me.id);
      let maxRec = Number((me as Record<string, unknown>).max_records) || 0;
      if (me.role === "surveyor") {
        const ownerRows = await sql`
            SELECT id, COALESCE(max_records, 0) AS max_records
            FROM app_users
            WHERE id = (
              SELECT created_by FROM app_users WHERE id = ${me.id} LIMIT 1
            ) AND role = 'admin'
            LIMIT 1
          `.catch(() => []);
        if (ownerRows.length) {
          ownerId = Number((ownerRows[0] as { id: number }).id);
          maxRec = Number((ownerRows[0] as { max_records?: unknown }).max_records) || 0;
        } else {
          maxRec = 0;
        }
      }
      if (maxRec > 0 && Number.isFinite(ownerId)) {
        const used = await countTenantRecords(sql, ownerId);
        if (used >= maxRec) {
          return json({
            error: `Record limit reached — maximum ${maxRec} records for this Client Admin (set by Super Admin).`,
            code: "max_records",
            used,
            max_records: maxRec,
          }, 422);
        }
      }
    }

    {
      const incomingKey0 = String(body.form_key || body.form_id || "").trim();
      if (incomingKey0 && incomingKey0 !== "default" && incomingKey0 !== "legacy") {
        const endedRows = await sql`
            SELECT ended_at FROM survey_form WHERE form_key = ${incomingKey0} LIMIT 1
          `.catch(() => []);
        if ((endedRows[0] as { ended_at?: unknown } | undefined)?.ended_at) {
          return json({
            error: "This survey has ended. New field records are closed.",
            ended: true,
            form_key: incomingKey0,
          }, 410);
        }
      }
    }

    // Per-survey target cap (this form_key vs that assignment's quota).
    // Does not lock other assigned surveys when one survey's quota is full.
    if (me.role === "surveyor") {
      const incomingKey = String(body.form_key || body.form_id || "").trim();
      const sUid = String(me.id);
      const sName1 = String(me.name || "");
      const sName2 = String(me.username || "");
      let surveyorCap = 0;
      let capFormKey = incomingKey;
      if (incomingKey && incomingKey !== "default") {
        const qRows = await sql`
            SELECT COALESCE(sa.target_quota, 0) AS target_quota, f.form_key
            FROM survey_assignments sa
            JOIN survey_form f ON f.id = sa.survey_id
            WHERE sa.user_id = ${me.id} AND f.form_key = ${incomingKey}
            LIMIT 1
          `.catch(() => []);
        surveyorCap = Number((qRows[0] as { target_quota?: number })?.target_quota) || 0;
      }
      if (surveyorCap <= 0) {
        const uRows = await sql`
            SELECT COALESCE(target_quota, 0) AS target_quota FROM app_users WHERE id = ${me.id} LIMIT 1
          `.catch(() => []);
        const userCap = Number((uRows[0] as { target_quota?: number })?.target_quota) || 0;
        const nAssigned = await sql`
            SELECT COUNT(*)::int AS n FROM survey_assignments WHERE user_id = ${me.id}
          `.catch(() => [{ n: 0 }]);
        // Only fall back to the user-level cap when this surveyor has 0–1 surveys,
        // so a second assigned survey is not locked by the first survey's fills.
        if ((sqlCountN(nAssigned[0]) || 0) <= 1) {
          surveyorCap = userCap;
          capFormKey = "";
        }
      }
      if (surveyorCap > 0) {
        const [sCountRow] = capFormKey
          ? await sql`
                SELECT COUNT(*)::int AS n
                FROM submissions
                WHERE (payload->>'user_id' = ${sUid}
                   OR (length(${sName1}) > 0 AND payload->>'submitted_by' = ${sName1})
                   OR (length(${sName2}) > 0 AND payload->>'submitted_by' = ${sName2}))
                  AND COALESCE(payload->>'form_key', payload->>'formKey', '') = ${capFormKey}
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                  AND COALESCE(payload->>'status', 'pending') <> 'rejected'
                  AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
              `.catch(() => [{ n: 0 }])
          : await sql`
                SELECT COUNT(*)::int AS n
                FROM submissions
                WHERE (payload->>'user_id' = ${sUid}
                   OR (length(${sName1}) > 0 AND payload->>'submitted_by' = ${sName1})
                   OR (length(${sName2}) > 0 AND payload->>'submitted_by' = ${sName2}))
                  AND COALESCE(payload->>'source', '') NOT IN ('web-survey', 'web')
                  AND COALESCE(payload->>'status', 'pending') <> 'rejected'
                  AND COALESCE(payload->>'draft', 'false') NOT IN ('true', 't', '1')
              `.catch(() => [{ n: 0 }]);
        const sUsed = sqlCountN(sCountRow);
        if (sUsed >= surveyorCap) {
          return json({
            error: `Target cap reached (${sUsed}/${surveyorCap} records${capFormKey ? ` for this survey` : ""}). Uploads stopped.`,
            code: "target_quota_reached",
            used: sUsed,
            target_quota: surveyorCap,
            form_key: capFormKey || incomingKey || null,
          }, 422);
        }
      }
    }

    // Require geo lock on every field submission. Web-survey fill (power-gated
    // above) is desk entry and has no GPS.
    const isWebFill = incomingSource === "web-survey" || incomingSource === "web";
    if (!isWebFill && (!geo || typeof geo !== "object")) {
      return json({
        error: "GPS lock required — lat/lng missing",
        code: "geo_lock_required",
      }, 422);
    }
    if (!isWebFill) {
      const gLat = Number((geo as Record<string, unknown>).lat ?? (geo as Record<string, unknown>).latitude);
      const gLng = Number((geo as Record<string, unknown>).lng ?? (geo as Record<string, unknown>).longitude);
      if (!Number.isFinite(gLat) || !Number.isFinite(gLng) || (gLat === 0 && gLng === 0)) {
        return json({
          error: "GPS lock invalid",
          code: "geo_lock_invalid",
        }, 422);
      }
    }

    const recIdxRaw = Number(
      body.record_index ??
        (answers as Record<string, unknown>)?._recordIndex ??
        (answers as Record<string, unknown>)?.recordIndex,
    );
    const recIdx = Number.isFinite(recIdxRaw) && recIdxRaw > 0 ? Math.round(recIdxRaw) : null;
    const payload = stripDraftFlags({
      form_key: body.form_key || "default",
      form_id: body.form_id || `field-${Date.now()}`,
      source: body.source || "mobile-field-survey",
      submitted_by: agent,
      user_id: me.id,
      user_role: me.role,
      status: "pending",
      record_index: recIdx,
      geo: geo,
      location_details: body.location_details || null,
      locks: body.locks || { geo: true },
      voice_required: body.voice_required === true || answers._voice_required === true,
      // Telugu interview → English transcript (batch Soniox, client-supplied).
      voice_transcript: (() => {
        const t = body.voice_transcript ?? (answers as Record<string, unknown>)._voice_transcript_en;
        const s = String(t || "").trim();
        return s ? s.slice(0, 20_000) : null;
      })(),
      voice_transcript_language: (() => {
        const t = body.voice_transcript ?? (answers as Record<string, unknown>)._voice_transcript_en;
        return String(t || "").trim() ? "en" : null;
      })(),
      voice_transcript_status: (() => {
        const t = body.voice_transcript ?? (answers as Record<string, unknown>)._voice_transcript_en;
        return String(t || "").trim() ? "completed" : "missing";
      })(),
      has_photo: false,
      has_audio: false,
      answers: stripPii({
        ...answers,
        data_collector: agent,
        ...(recIdx != null ? { _recordIndex: recIdx } : {}),
      }),
      // Q/A separated from media blobs
      content_type: "qa",
      // Client app version (pushed from React build)
      app_version: body.app_version ? String(body.app_version) : null,
      app_build: body.app_build ? String(body.app_build) : null,
      app_version_code: body.app_version_code != null
        ? Number(body.app_version_code)
        : null,
    });
    // BR-004 write scope: records may only be written into projects the caller
    // belongs to. Client Admins → own/assigned projects (plus the always-visible
    // legacy/default forms); Surveyors → the surveys they are assigned to (or the
    // shared default form, which the field app uses when no assignment exists).
    if (me.role === "admin") {
      const writeScope = await adminFormKeyScope(sql, me);
      const fk = String(payload.form_key || "default");
      if (writeScope && !writeScope.includes(fk)) {
        return json({
          error: `You can only submit records to your own projects (${writeScope.length ? writeScope.join(", ") : "none"})`,
        }, 403);
      }
    } else if (me.role === "surveyor") {
      const fk = String(payload.form_key || "default");
      if (fk !== "default") {
        const asg = await sql`
            SELECT f.form_key FROM survey_assignments a
            JOIN survey_form f ON f.id = a.survey_id
            WHERE a.user_id = ${me.id} AND f.form_key = ${fk}
            LIMIT 1
          `.catch(() => []);
        if (!asg.length) {
          return json({
            error: "You are not assigned to this survey. Ask your Client Admin for the survey assignment.",
          }, 403);
        }
      }
    }
    // Idempotent: a field-app sync retry of the same package must not insert a duplicate
    const pkgId = String(
      (answers as Record<string, unknown>)?.client_package_id ||
        body.client_package_id ||
        "",
    ).trim();
    if (pkgId) {
      const existing = await sql`
          SELECT id FROM submissions
          WHERE payload->'answers'->>'client_package_id' = ${pkgId}
             OR payload->>'client_package_id' = ${pkgId}
          ORDER BY id LIMIT 1
        `.catch(() => []);
      if (existing.length) {
        return json({
          ok: true,
          duplicate: true,
          id: (existing[0] as { id: number }).id,
          note: "Already received — returning existing record",
        });
      }
    }
    const rows = await insertSubmissionRow(payload);
    const row = rows[0] as { id: number; payload: unknown; created_at: string };
    if (me.role === "surveyor") {
      logAudit(me, "submission_create", "submission", row.id, {
        form_key: payload.form_key || null,
      });
    }
    // If package already includes media flags (or later media uploads complete), auto-confirm
    const auto = await autoConfirmIfComplete(sql, Number(row.id)).catch(() => ({
      auto_confirmed: false,
      completeness: "incomplete",
    }));
    return json({
      ok: true,
      id: row.id,
      form_id: payload.form_id,
      source: payload.source,
      submitted_by: agent,
      status: auto.auto_confirmed ? "confirmed" : "pending",
      completeness: auto.completeness,
      auto_confirmed: auto.auto_confirmed,
      answers: payload.answers,
      geo,
      created_at: row.created_at,
      next: auto.auto_confirmed
        ? "Record complete — visible in Client Admin Report automatically"
        : "POST /api/submissions/:id/media with kind=photo|audio",
      note: auto.auto_confirmed
        ? "Q/A + media complete — pending Client Admin review."
        : "Q/A saved. Upload photo and audio separately; stays pending until Client Admin confirms.",
    }, 201);
  }
  return null;
}

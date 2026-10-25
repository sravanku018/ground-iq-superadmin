import type { Ctx } from "./ctx.ts";
import {
  b64ToBytes,
  isImageBytes,
  splitDataUrl,
} from "../lib/bytes.ts";
import {
  corsHeaders,
} from "../lib/cors.ts";
import {
  sql,
  sqlJson,
} from "../lib/db.ts";
import {
  autoConfirmIfComplete,
} from "../lib/facts.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  parsePayload,
} from "../lib/payload.ts";
import {
  storeMediaLinked,
} from "../lib/r2-media.ts";
import {
  hasPower,
} from "../lib/survey-assignments.ts";
import {
  adminFormKeyScope,
} from "../lib/tenant.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

export async function handleMedia(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, me } = c;
  // Separate media upload — DEFAULT Neon (no card). Optional R2/custom if env set.
  if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    if (me.role !== "admin" && me.role !== "surveyor") {
      return json({ error: "Forbidden" }, 403);
    }
    const id = Number(path.split("/")[3]);
    const body = await readBody(req);
    const kind = String(body.kind || "").toLowerCase(); // photo | audio
    if (kind !== "photo" && kind !== "audio") {
      return json({ error: "kind must be photo or audio" }, 400);
    }

    const scopeKeys = await adminFormKeyScope(sql, me);
    const exists = scopeKeys
      ? await sql`SELECT id, payload FROM submissions WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys})`
      : await sql`SELECT id, payload FROM submissions WHERE id = ${id}`;
    if (!exists.length) return json({ error: "Submission not found" }, 404);

    let mime = String(
      body.mime || (kind === "photo" ? "image/jpeg" : "audio/webm"),
    );
    let publicUrl = body.url ? String(body.url).trim() : "";
    let provider = body.storage ? String(body.storage) : "";
    let dataB64 = "";
    let byteLen = 0;
    let mode: "external" | "neon" | "client_url" = "neon";

    if (publicUrl && /^https?:\/\//i.test(publicUrl)) {
      provider = provider || "client_url";
      mode = "client_url";
    } else {
      let data = String(body.data || "");
      const parsed = splitDataUrl(data);
      if (parsed.mime) {
        mime = String(body.mime || parsed.mime || mime).split(";")[0].trim() || mime;
        data = parsed.b64;
      } else if (parsed.b64 !== data) {
        data = parsed.b64;
      }
      // Incoming cap (~2.1MB base64 for ~1.5MB binary)
      if (data.length > 2_100_000) {
        return json({
          error: "Media too large. Compress photo or shorten audio (max ~1.5MB).",
        }, 413);
      }
      if (!data) {
        return json({ error: "data (base64) required" }, 400);
      }
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = b64ToBytes(data);
      } catch {
        return json({ error: "Invalid base64 media data" }, 400);
      }
      byteLen = bytes.length;
      if (byteLen < 50) {
        return json({ error: "Media file too small / empty" }, 400);
      }
      if (kind === "photo" && !isImageBytes(bytes)) {
        return json({ error: "Not a valid image file (JPEG/PNG/GIF/WebP)" }, 400);
      }
      try {
        const stored = await storeMediaLinked(bytes, mime, kind);
        provider = stored.provider;
        mode = stored.mode;
        publicUrl = stored.url || "";
        dataB64 = stored.dataB64 || "";
      } catch (e) {
        return json({
          error: (e as Error).message || "Media store failed",
          hint: "No credit card needed — media is stored free in Neon (size-limited).",
        }, 413);
      }
    }

    const meta = {
      ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
      storage: provider,
      bytes: byteLen || null,
      mode,
      no_card: true,
    };

    const mediaRows = await sql`
        INSERT INTO survey_media (submission_id, kind, mime, data, url, storage, meta)
        VALUES (
          ${id},
          ${kind},
          ${mime},
          ${dataB64},
          ${publicUrl || null},
          ${provider},
          ${meta}::jsonb
        )
        RETURNING id, kind, mime, url, storage, created_at
      `.catch(async () =>
      await sql`
          INSERT INTO survey_media (submission_id, kind, mime, data, meta)
          VALUES (
            ${id},
            ${kind},
            ${mime},
            ${dataB64 || (publicUrl ? `url:${publicUrl}` : "")},
            ${meta}::jsonb
          )
          RETURNING id, kind, mime, created_at
        `
    );

    const mediaId = Number((mediaRows[0] as { id: number }).id);
    // Neon-hosted files are served by API (auth) — no external card service
    if (mode === "neon" && !publicUrl) {
      publicUrl = `/api/media/${mediaId}/file`;
      await sql`
          UPDATE survey_media SET url = ${publicUrl} WHERE id = ${mediaId}
        `.catch(() => null);
    }

    let payload = parsePayload(exists[0].payload);
    if (kind === "photo") {
      payload.has_photo = true;
      payload.photo_url = publicUrl;
      payload.photo_media_id = mediaId;
    }
    if (kind === "audio") {
      payload.has_audio = true;
      payload.audio_url = publicUrl;
      payload.audio_media_id = mediaId;
    }
    payload.media_storage = provider;
    payload.media_updated_at = new Date().toISOString();
    await sql`
        UPDATE submissions SET payload = ${sqlJson(payload)} WHERE id = ${id}
      `;

    // After each media piece: if geo+photo+voice+QA all present, auto-confirm for Client Admin
    const auto = await autoConfirmIfComplete(sql, id).catch(() => ({
      auto_confirmed: false,
      completeness: "incomplete",
    }));

    return json({
      ok: true,
      submission_id: id,
      media: {
        id: mediaId,
        kind,
        mime,
        url: publicUrl,
        storage: provider,
        mode,
      },
      free_storage: true,
      no_card: true,
      linked: true,
      url: publicUrl,
      storage: provider,
      status: auto.auto_confirmed ? "confirmed" : "pending",
      completeness: auto.completeness,
      auto_confirmed: auto.auto_confirmed,
      note: auto.auto_confirmed
        ? `${kind} linked — pending Client Admin review.`
        : mode === "neon"
          ? `${kind} linked free in Neon (no credit card). Admin opens via API.`
          : `${kind} linked on ${provider}.`,
    }, 201);
  }

  // Stream & download media file (Neon storage) — audio, video, photo
  // Only Client Admins / Super Admin may access this — surveyors have no
  // permission here. A Client Admin additionally needs can_review_data,
  // which only Super Admin can grant (see hasPower/isPortalAdmin, 214-224).
  // Also scoped to the requesting admin's own submissions (same
  // payload->>'form_key' = ANY(scopeKeys) pattern used everywhere else in
  // this file) so one Client Admin can't reach another's media by
  // guessing/incrementing the numeric media id.
  if (path.match(/^\/api\/media\/\d+\/file$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    if (!hasPower(me, "can_review_data") && !hasPower(me, "can_validate_proof")) {
      return json({ error: "You don't have permission to view media — ask your Super Admin to enable it." }, 403);
    }
    const mediaId = Number(path.split("/")[3]);
    const scopeKeys = await adminFormKeyScope(sql, me);
    const owns = scopeKeys
      ? await sql`
            SELECT sm.id
            FROM survey_media sm
            JOIN submissions s ON s.id = sm.submission_id
            WHERE sm.id = ${mediaId} AND s.payload->>'form_key' = ANY(${scopeKeys})
            LIMIT 1
          `.catch(() => [])
      : await sql`SELECT id FROM survey_media WHERE id = ${mediaId} LIMIT 1`.catch(() => []);
    if (!owns.length) return json({ error: "Not found" }, 404);
    const rows = await sql`
        SELECT id, kind, mime, data, url, storage, submission_id
        FROM survey_media WHERE id = ${mediaId} LIMIT 1
      `.catch(async () =>
      await sql`
          SELECT id, kind, mime, data, submission_id
          FROM survey_media WHERE id = ${mediaId} LIMIT 1
        `
    );
    if (!rows.length) return json({ error: "Not found" }, 404);
    const row = rows[0] as {
      id: number;
      kind: string;
      mime: string;
      data: string;
      url?: string;
      storage?: string;
    };
    // Proxy external/R2 URLs — never 302. Zip/export fetch from the
    // admin origin cannot follow a storage redirect (CORS NetworkError).
    const external =
      row.url && /^https?:\/\//i.test(String(row.url))
        ? String(row.url)
        : String(row.data || "").startsWith("url:")
          ? String(row.data).slice(4)
          : "";
    if (external) {
      try {
        const up = await fetch(external);
        if (!up.ok) return json({ error: "Upstream media failed" }, 502);
        const body = new Uint8Array(await up.arrayBuffer());
        const mime = row.mime || up.headers.get("content-type") || "application/octet-stream";
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": mime,
            "content-length": String(body.length),
            "cache-control": "private, max-age=3600",
            ...corsHeaders(req),
          },
        });
      } catch (e) {
        return json({ error: (e as Error).message || "Upstream media failed" }, 502);
      }
    }
    const raw = String(row.data || "");
    if (!raw) return json({ error: "No media data" }, 404);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = b64ToBytes(raw);
    } catch {
      return json({ error: "Corrupt media data" }, 500);
    }

    const isDownload = url.searchParams.get("download") === "1";
    const mime = row.mime || (row.kind === "audio" ? "audio/webm" : row.kind === "video" ? "video/mp4" : "image/jpeg");
    const ext = mime.includes("audio")
      ? "mp3"
      : mime.includes("video")
      ? "mp4"
      : mime.includes("png")
      ? "png"
      : mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : "bin";

    const filename = `${row.kind || "media"}-${row.id}.${ext}`;
    const disp = isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`;

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": mime,
        "accept-ranges": "bytes",
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=86400",
        "content-disposition": disp,
        ...corsHeaders(req),
      },
    });
  }

  // List media for a submission — returns free links (Neon API or external URL)
  if (path.match(/^\/api\/submissions\/\d+\/media$/) && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const id = Number(path.split("/")[3]);
    if (isPortalAdmin(me.role)) {
      // Client Admins see media only for records in their own/assigned projects.
      const scopeKeys = await adminFormKeyScope(sql, me);
      if (scopeKeys) {
        const visible = await sql`
            SELECT id FROM submissions
            WHERE id = ${id} AND payload->>'form_key' = ANY(${scopeKeys}) LIMIT 1
          `.catch(() => []);
        if (!visible.length) return json({ error: "Not found" }, 404);
      }
    } else {
      // Surveyor can view media only for their own submission
      const own = await sql`
          SELECT id FROM submissions WHERE id = ${id}
            AND (payload->>'user_id' = ${String(me.id)}
                 OR payload->>'submitted_by' = ANY(${[me.name, me.username].filter(Boolean)}))
          LIMIT 1
        `.catch(() => []);
      if (!own.length) return json({ error: "Admin only" }, 403);
    }
    const rows = await sql`
        SELECT id, kind, mime, url, storage, meta, created_at,
               CASE WHEN data IS NULL OR data = '' THEN 0 ELSE length(data) END AS neon_bytes
        FROM survey_media WHERE submission_id = ${id} ORDER BY id
      `.catch(async () =>
      await sql`
          SELECT id, kind, mime, meta, created_at, data,
                 length(data) AS neon_bytes
          FROM survey_media WHERE submission_id = ${id} ORDER BY id
        `
    );
    const media = (rows as Record<string, unknown>[]).map((r) => {
      const meta =
        typeof r.meta === "string"
          ? parsePayload(r.meta)
          : (r.meta as Record<string, unknown>) || {};
      let url = (r.url as string) || (meta.url as string) || null;
      if (!url && r.id) url = `/api/media/${r.id}/file`;
      if (!url && typeof r.data === "string" && String(r.data).startsWith("url:")) {
        url = String(r.data).slice(4);
      }
      return {
        id: r.id,
        kind: r.kind,
        mime: r.mime,
        url,
        storage: r.storage || meta.storage || "neon",
        neon_bytes: r.neon_bytes || 0,
        no_card: true,
        meta,
        created_at: r.created_at,
      };
    });
    return json({
      submission_id: id,
      media,
      free_storage: true,
      no_card: true,
      note: "Default storage is free Neon (no credit card). Paths /api/media/:id/file need admin login.",
    });
  }
  return null;
}

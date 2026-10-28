import type { Ctx } from "./ctx.ts";
import {
  deleteSonioxFile,
  pollSonioxTranscription,
  sonioxConfigInfo,
  startSonioxTranscription,
} from "../../../lib/soniox.ts";
import {
  b64ToBytes,
  splitDataUrl,
} from "../lib/bytes.ts";
import {
  CORS_HEADERS,
} from "../lib/cors.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  bytesToBase64,
} from "../lib/r2-media.ts";
import {
  syncSonioxKeyFromDb,
} from "../lib/soniox-sync.ts";
import {
  isoStamp,
} from "../lib/time.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";

export async function handleConversations(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, me } = c;
  // ── Offline field conversations (voice note + batch English translation) ──
  // The phone records and stores audio locally; when it has connectivity it
  // uploads once here. Soniox runs server-side (API key never ships in the app).
  const CONVERSATION_MAX_BYTES = 2_000_000;

  function conversationPublic(r: Record<string, unknown>) {
    const id = Number(r.id);
    const hasAudio = Number(r.audio_bytes || 0) > 0;
    return {
      id,
      user_id: r.user_id != null ? Number(r.user_id) : null,
      username: r.username ? String(r.username) : "",
      submitted_by: r.display_name
        ? String(r.display_name)
        : r.username
          ? String(r.username)
          : "",
      local_id: r.local_id ? String(r.local_id) : null,
      form_key: r.form_key ? String(r.form_key) : null,
      title: r.title ? String(r.title) : "",
      recorded_at: isoStamp(r.recorded_at),
      duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
      audio_mime: r.audio_mime ? String(r.audio_mime) : "audio/webm",
      audio_bytes: r.audio_bytes != null ? Number(r.audio_bytes) : null,
      has_audio: hasAudio,
      audio_url: hasAudio ? `/api/conversations/${id}/audio` : null,
      transcript: r.transcript ? String(r.transcript) : "",
      transcript_original: r.transcript_original ? String(r.transcript_original) : "",
      transcript_status: r.transcript_status ? String(r.transcript_status) : "stored",
      transcript_error: r.transcript_error ? String(r.transcript_error) : null,
      created_at: isoStamp(r.created_at),
      updated_at: isoStamp(r.updated_at),
    };
  }

  async function loadConversation(id: number, opts: { audio?: boolean } = {}) {
    if (!me) return null;
    // Polling must not drag the base64 audio through every status check.
    const rows = opts.audio
      ? await sql`SELECT * FROM conversations WHERE id = ${id} LIMIT 1`.catch(() => [])
      : await sql`
            SELECT id, user_id, local_id, form_key, title, recorded_at, duration_ms,
                   audio_mime, audio_bytes, transcript, transcript_original,
                   transcript_status, transcript_error, soniox_file_id,
                   soniox_transcription_id, created_at, updated_at
            FROM conversations
            WHERE id = ${id}
            LIMIT 1
          `.catch(() => []);
    if (!rows.length) return null;
    const row = rows[0] as Record<string, unknown>;
    const owner = Number(row.user_id) === Number(me.id);
    if (!owner && !isPortalAdmin(me.role)) return null;
    return row;
  }

  /** Ask Soniox for the current state and persist whatever it reports. */
  async function refreshConversationTranscript(row: Record<string, unknown>) {
    const transcriptionId = String(row.soniox_transcription_id || "");
    const id = Number(row.id);
    if (!transcriptionId) return row;
    try {
      const result = await pollSonioxTranscription(transcriptionId);
      if (result.status === "completed") {
        const rows = await sql`
            UPDATE conversations
            SET transcript = ${result.transcript || ""},
                transcript_original = ${result.transcriptOriginal || ""},
                transcript_status = 'completed',
                transcript_error = NULL,
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
          `;
        void deleteSonioxFile(String(row.soniox_file_id || ""));
        return (rows[0] as Record<string, unknown>) || { ...row, transcript_status: "completed" };
      }
      if (result.status === "error") {
        const rows = await sql`
            UPDATE conversations
            SET transcript_status = 'error',
                transcript_error = ${result.error || "Transcription failed"},
                updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
          `;
        // A retry re-uploads from the audio stored in our DB, so the failed
        // Soniox copy is no longer useful.
        void deleteSonioxFile(String(row.soniox_file_id || ""));
        return (rows[0] as Record<string, unknown>) || row;
      }
      const rows = await sql`
          UPDATE conversations
          SET transcript_status = ${result.status || "processing"},
              updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `.catch(() => []);
      return (rows[0] as Record<string, unknown>) || row;
    } catch (e) {
      const message = (e as Error)?.message || "Soniox request failed";
      const rows = await sql`
          UPDATE conversations
          SET transcript_status = 'error',
              transcript_error = ${message},
              updated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `.catch(() => []);
      return (rows[0] as Record<string, unknown>) || row;
    }
  }

  /**
   * Converse entitlement + limits for this account. A surveyor inherits the
   * grant from the Client Admin who created them / shares their company
   * (same rule as can_record_voice). Limits: 0 = unlimited records, and
   * 0 minutes falls back to the 10-minute server default.
   */
  async function orgConverseGrant(userId: number, role: string, selfGrant: boolean) {
    if (role === "super_admin") {
      return { enabled: true, maxRecords: 0, maxMinutes: 0 };
    }
    if (selfGrant || isPortalAdmin(role)) {
      return { enabled: true, maxRecords: 0, maxMinutes: 0 };
    }
    const rows = await sql`
        SELECT COALESCE(owner.can_converse, FALSE) AS granted,
               COALESCE(owner.converse_max_records, 0) AS max_records,
               COALESCE(owner.converse_max_minutes, 0) AS max_minutes
        FROM app_users u
        JOIN app_users owner
          ON owner.id = u.created_by
          OR (u.company_id IS NOT NULL AND owner.company_id = u.company_id AND owner.role = 'admin')
        WHERE u.id = ${userId}
        ORDER BY (owner.role = 'admin') DESC
        LIMIT 1
      `.catch(() => []);
    const r = (rows[0] || {}) as Record<string, unknown>;
    return {
      enabled: r.granted === true,
      maxRecords: Number(r.max_records) || 0,
      maxMinutes: Number(r.max_minutes) || 0,
    };
  }

  if (path === "/api/conversations/config" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    await syncSonioxKeyFromDb();
    // Converse is governed ONLY by the can_converse grant — the old
    // can_record_voice toggle now means per-question voice in surveys and no
    // longer leaks into this tab. Admins and Super Admin always have it.
    const grant = await orgConverseGrant(
      Number(me.id),
      me.role,
      (me as Record<string, unknown>).can_record_voice === true,
    );
    const voiceEnabled = grant.enabled;
    const maxMinutes = grant.maxMinutes > 0 ? grant.maxMinutes : 10;
    return json({
      ...sonioxConfigInfo(),
      voice_enabled: voiceEnabled,
      can_converse: grant.enabled,
      converse_max_records: grant.maxRecords,
      converse_max_minutes: maxMinutes,
      max_duration_sec: maxMinutes * 60,
      max_audio_bytes: CONVERSATION_MAX_BYTES,
      note: "Record offline; audio uploads and is translated to English when connectivity returns.",
    });
  }

  if (path === "/api/conversations" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const adminView = isPortalAdmin(me.role) && url.searchParams.get("all") === "1";
    // Admins use this list for the Analyze & Export tab, so allow more rows
    // than a single surveyor needs for their own history.
    const maxLimit = adminView ? 1000 : 200;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), maxLimit);
    const rows = adminView
      ? await sql`
            SELECT c.id, c.user_id, c.local_id, c.form_key, c.title, c.recorded_at,
                   c.duration_ms, c.audio_mime, c.audio_bytes, c.transcript,
                   c.transcript_original, c.transcript_status, c.transcript_error,
                   c.created_at, c.updated_at, u.username, u.display_name
            FROM conversations c
            LEFT JOIN app_users u ON u.id = c.user_id
            ORDER BY COALESCE(c.recorded_at, c.created_at) DESC, c.id DESC
            LIMIT ${limit}
          `.catch(() => [])
      : await sql`
            SELECT id, user_id, local_id, form_key, title, recorded_at, duration_ms,
                   audio_mime, audio_bytes, transcript, transcript_original,
                   transcript_status, transcript_error, created_at, updated_at
            FROM conversations
            WHERE user_id = ${me.id}
            ORDER BY COALESCE(recorded_at, created_at) DESC, id DESC
            LIMIT ${limit}
          `.catch(() => []);
    return json({
      items: (rows as Record<string, unknown>[]).map(conversationPublic),
      count: rows.length,
      soniox_enabled: sonioxConfigInfo().enabled,
    });
  }

  if (path === "/api/conversations" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    // Org-level Converse enforcement: grant, per-surveyor record quota and
    // per-record minutes are all chosen by the Super Admin on the Client Admin.
    const grant = await orgConverseGrant(
      Number(me.id),
      me.role,
      (me as Record<string, unknown>).can_record_voice === true,
    );
    if (!grant.enabled) {
      return json({ error: "Converse is not enabled for your team. Ask your admin." }, 403);
    }
    const body = await readBody(req);
    const maxMinutes = grant.maxMinutes > 0 ? grant.maxMinutes : 10;
    const statedMs = Number(body.duration_ms) || 0;
    if (statedMs > maxMinutes * 60_000 + 5_000) {
      return json(
        { error: `Recording is longer than the ${maxMinutes} minute limit set for your team. Split it into shorter conversations.` },
        413,
      );
    }
    if (grant.maxRecords > 0) {
      const countRows = await sql`
          SELECT COUNT(*)::int AS n FROM conversations WHERE user_id = ${me.id}
        `.catch(() => []);
      const used = Number((countRows[0] as { n?: number })?.n) || 0;
      if (used >= grant.maxRecords) {
        return json(
          { error: `Conversation limit reached (${grant.maxRecords} records). Ask your admin for more.` },
          403,
        );
      }
    }
    const localId = String(body.local_id || "").trim().slice(0, 120);
    if (localId) {
      const existing = await sql`
          SELECT * FROM conversations
          WHERE user_id = ${me.id} AND local_id = ${localId}
          LIMIT 1
        `.catch(() => []);
      if (existing.length) {
        return json({
          ok: true,
          duplicate: true,
          conversation: conversationPublic(existing[0] as Record<string, unknown>),
        });
      }
    }
    const parsed = splitDataUrl(String(body.audio || body.data || ""));
    const bytes = b64ToBytes(parsed.b64);
    if (!bytes.length) return json({ error: "audio (base64 data URL) is required" }, 400);
    if (bytes.length > CONVERSATION_MAX_BYTES) {
      return json({
        error: `Conversation audio too large (${bytes.length} bytes). Maximum is ${CONVERSATION_MAX_BYTES} bytes.`,
        code: "audio_too_large",
      }, 413);
    }
    const mime = String(body.mime || parsed.mime || "audio/webm").split(";")[0].trim() || "audio/webm";
    const recorded = new Date(String(body.recorded_at || ""));
    const recordedAt = Number.isNaN(recorded.getTime()) ? new Date() : recorded;
    const title = String(body.title || "").trim().slice(0, 160) || "Conversation";
    const formKey = body.form_key ? String(body.form_key).trim().slice(0, 120) : null;
    const durationMs = Number(body.duration_ms);
    const transcript = body.transcript ? String(body.transcript).trim().slice(0, 20_000) : null;

    const inserted = await sql`
        INSERT INTO conversations (
          user_id, local_id, form_key, title, recorded_at, duration_ms,
          audio_mime, audio_data, audio_bytes, transcript, transcript_status
        ) VALUES (
          ${me.id}, ${localId || null}, ${formKey}, ${title}, ${recordedAt},
          ${Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null},
          ${mime}, ${bytesToBase64(bytes)}, ${bytes.length},
          ${transcript}, ${transcript ? "completed" : "stored"}
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `.catch((e: unknown) => {
      console.error("conversation insert:", (e as Error)?.message || e);
      return [];
    });
    if (!inserted.length) {
      // Lost an insert race on local_id — return the row the other request made.
      if (localId) {
        const rows = await sql`
            SELECT * FROM conversations WHERE user_id = ${me.id} AND local_id = ${localId} LIMIT 1
          `.catch(() => []);
        if (rows.length) {
          return json({
            ok: true,
            duplicate: true,
            conversation: conversationPublic(rows[0] as Record<string, unknown>),
          });
        }
      }
      return json({ error: "Could not save conversation" }, 500);
    }
    return json({
      ok: true,
      conversation: conversationPublic(inserted[0] as Record<string, unknown>),
    }, 201);
  }

  const convAudioMatch = path.match(/^\/api\/conversations\/(\d+)\/audio$/);
  if (convAudioMatch && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    const row = await loadConversation(Number(convAudioMatch[1]), { audio: true });
    if (!row) return json({ error: "Not found" }, 404);
    const bytes = b64ToBytes(String(row.audio_data || ""));
    if (!bytes.length) return json({ error: "No audio stored for this conversation" }, 404);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": String(row.audio_mime || "audio/webm"),
        "content-length": String(bytes.length),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const convTranscribeMatch = path.match(/^\/api\/conversations\/(\d+)\/transcribe$/);
  if (convTranscribeMatch && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    await syncSonioxKeyFromDb();
    let row = await loadConversation(Number(convTranscribeMatch[1]), { audio: true });
    if (!row) return json({ error: "Not found" }, 404);
    if (String(row.transcript_status || "") === "completed" && row.transcript) {
      return json({ ok: true, conversation: conversationPublic(row) });
    }
    // A failed Soniox job is retryable: start a fresh one from the audio we
    // already stored, instead of polling the dead transcription forever.
    if (String(row.transcript_status || "") === "error") {
      row.soniox_transcription_id = null;
      row.soniox_file_id = null;
    }
    if (!row.soniox_transcription_id) {
      if (!sonioxConfigInfo().enabled) {
        return json({
          error: "Voice translation is not enabled on the server.",
          code: "soniox_not_configured",
        }, 503);
      }
      const bytes = b64ToBytes(String(row.audio_data || ""));
      if (!bytes.length) return json({ error: "No audio stored for this conversation" }, 400);
      try {
        const job = await startSonioxTranscription(
          bytes,
          String(row.audio_mime || "audio/webm"),
        );
        const rows = await sql`
            UPDATE conversations
            SET soniox_file_id = ${job.fileId},
                soniox_transcription_id = ${job.transcriptionId},
                transcript_status = 'processing',
                transcript_error = NULL,
                updated_at = NOW()
            WHERE id = ${Number(row.id)}
            RETURNING *
          `;
        row = (rows[0] as Record<string, unknown>) || {
          ...row,
          soniox_file_id: job.fileId,
          soniox_transcription_id: job.transcriptionId,
          transcript_status: "processing",
        };
      } catch (e) {
        const message = (e as Error)?.message || "Soniox request failed";
        await sql`
            UPDATE conversations
            SET transcript_status = 'error', transcript_error = ${message}, updated_at = NOW()
            WHERE id = ${Number(row.id)}
          `.catch(() => null);
        return json({ error: message }, 502);
      }
    }
    // Short clips often finish before the first poll; one cheap check usually
    // saves the client a round trip. Longer clips keep polling via GET /:id.
    await new Promise((r) => setTimeout(r, 600));
    row = await refreshConversationTranscript(row);
    return json({ ok: true, conversation: conversationPublic(row) });
  }

  const convIdMatch = path.match(/^\/api\/conversations\/(\d+)$/);
  if (convIdMatch && (method === "GET" || method === "DELETE")) {
    if (!me) return json({ error: "Login required" }, 401);
    await syncSonioxKeyFromDb();
    const id = Number(convIdMatch[1]);
    let row = await loadConversation(id);
    if (!row) return json({ error: "Not found" }, 404);
    if (method === "DELETE") {
      await sql`DELETE FROM conversations WHERE id = ${id}`.catch(() => null);
      void deleteSonioxFile(String(row.soniox_file_id || ""));
      return json({ ok: true, deleted: id });
    }
    if (
      row.soniox_transcription_id &&
      String(row.transcript_status || "") !== "completed" &&
      String(row.transcript_status || "") !== "error"
    ) {
      row = await refreshConversationTranscript(row);
    }
    return json({ ok: true, conversation: conversationPublic(row) });
  }

  // ── Batch transcription for the field app's survey voice recordings ──
  // Client posts the recorded blob once, then polls the job id. The audio is
  // uploaded to Soniox by the server, so the phone only needs connectivity now.
  if (path === "/api/transcribe" && method === "POST") {
    if (!me) return json({ error: "Login required" }, 401);
    await syncSonioxKeyFromDb();
    if (!sonioxConfigInfo().enabled) {
      return json({
        error: "Voice translation is not enabled on the server.",
        code: "soniox_not_configured",
      }, 503);
    }
    let mime = (req.headers.get("content-type") || "audio/webm").split(";")[0].trim() ||
      "audio/webm";
    let bytes: Uint8Array;
    if (mime.includes("application/json")) {
      const body = await readBody(req);
      const parsed = splitDataUrl(String(body.audio || body.data || ""));
      bytes = b64ToBytes(parsed.b64);
      mime = String(body.mime || parsed.mime || "audio/webm").split(";")[0].trim() ||
        "audio/webm";
    } else {
      const buf = await req.arrayBuffer();
      bytes = new Uint8Array(buf);
    }
    if (!bytes.length) return json({ error: "Audio body is required" }, 400);
    if (bytes.length > 12_000_000) {
      return json({ error: "Audio too large (max 12 MB)" }, 413);
    }
    try {
      const job = await startSonioxTranscription(bytes, mime);
      return json({
        ok: true,
        job_id: `${job.transcriptionId}.${job.fileId}`,
        status: "processing",
      }, 202);
    } catch (e) {
      const message = (e as Error)?.message || "Soniox request failed";
      const status = Number((e as Error & { status?: number })?.status) || 502;
      return json({ error: message }, status === 401 ? 502 : status);
    }
  }

  const transcribeJobMatch = path.match(/^\/api\/transcribe\/([A-Za-z0-9_.-]+)$/);
  if (transcribeJobMatch && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    await syncSonioxKeyFromDb();
    const [transcriptionId] = transcribeJobMatch[1].split(".");
    if (!transcriptionId) return json({ error: "Invalid job id" }, 400);
    try {
      const result = await pollSonioxTranscription(transcriptionId);
      return json({
        ok: result.status !== "error",
        status: result.status,
        text: result.transcript || "",
        source_text: result.transcriptOriginal || "",
        error: result.error || null,
      });
    } catch (e) {
      const message = (e as Error)?.message || "Soniox request failed";
      return json({ status: "error", error: message }, 502);
    }
  }
  return null;
}

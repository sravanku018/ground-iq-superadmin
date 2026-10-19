/**
 * Soniox async speech-to-text client (batch, not streaming).
 *
 * Flow: upload audio → create transcription with one-way English translation →
 * poll status → read tokens. Used by conversation uploads and field voice
 * recordings. The API key is server-side only (Deno env `SONIOX_API_KEY`);
 * it is never bundled into the APK/web build.
 */

const API_BASE = "https://api.soniox.com";
const MODEL = "stt-async-v5";
/** Telugu spoken in the field, English answers mixed in. Translate all to English. */
const LANGUAGE_HINTS = ["te", "en"];
const TARGET_LANGUAGE = "en";

export type SonioxJob = {
  fileId: string;
  transcriptionId: string;
};

export type SonioxResult = {
  status: "queued" | "processing" | "completed" | "error" | string;
  transcript?: string;
  transcriptOriginal?: string;
  error?: string;
};

let runtimeKey = "";

export function sonioxApiKey(): string {
  // A key saved by Super Admin in the portal wins, so the key can be rotated
  // without shell access to the server. Environment variables remain the
  // fallback for deployments that prefer them.
  return (
    runtimeKey ||
    Deno.env.get("SONIOX_API_KEY") ||
    Deno.env.get("SONIOX_KEY") ||
    ""
  ).trim();
}

/** Set/clear the key stored in the database (empty string clears it). */
export function setSonioxRuntimeKey(key: string): void {
  runtimeKey = String(key || "").trim();
}

/** Verify a key without changing the active one. */
export async function validateSonioxKey(key: string): Promise<void> {
  const candidate = String(key || "").trim();
  if (!candidate) throw new Error("API key is required");
  const res = await fetch(`${API_BASE}/v1/files?limit=1`, {
    headers: { Authorization: `Bearer ${candidate}` },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as Record<string, unknown>;
      detail = String(
        data.error_message || data.message || data.error || detail,
      );
    } catch {
      /* keep status text */
    }
    throw new Error(`Soniox rejected the key: ${detail}`);
  }
}

/** Masked hint for the Super Admin UI. */
export function sonioxKeyHint(): string {
  const key = sonioxApiKey();
  if (!key) return "";
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

export function sonioxKeySource(): "database" | "environment" | "none" {
  if (runtimeKey) return "database";
  if ((Deno.env.get("SONIOX_API_KEY") || Deno.env.get("SONIOX_KEY") || "").trim()) {
    return "environment";
  }
  return "none";
}

export function sonioxEnabled(): boolean {
  return Boolean(sonioxApiKey());
}

/** Translate/transcribe already-known language hints; exported for the config endpoint. */
export function sonioxConfigInfo() {
  return {
    enabled: sonioxEnabled(),
    model: MODEL,
    language_hints: LANGUAGE_HINTS,
    target_language: TARGET_LANGUAGE,
  };
}

type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
};

async function sonioxFetch(
  path: string,
  init: FetchInit = {},
): Promise<Record<string, unknown>> {
  const key = sonioxApiKey();
  if (!key) {
    const err = new Error("Soniox is not configured on the server (SONIOX_API_KEY missing)");
    (err as Error & { status?: number }).status = 503;
    throw err;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init.headers || {}),
    },
    body: init.body ?? null,
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = { raw: text.slice(0, 500) };
    }
  }
  if (!res.ok) {
    const detail = String(
      data.error_message || data.message || data.error || data.raw || `HTTP ${res.status}`,
    );
    const err = new Error(`Soniox: ${detail}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return data;
}

function extensionForMime(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "bin";
}

/** Upload one audio blob and queue an async transcription. */
export async function startSonioxTranscription(
  bytes: Uint8Array,
  mime: string,
): Promise<SonioxJob> {
  if (!bytes.length) throw new Error("Empty audio recording");
  const key = sonioxApiKey();
  if (!key) {
    const err = new Error("Soniox is not configured on the server (SONIOX_API_KEY missing)");
    (err as Error & { status?: number }).status = 503;
    throw err;
  }

  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed view so the Blob is portable across runtimes.
  const audio = new Uint8Array(bytes);
  form.append(
    "file",
    new Blob([audio], { type: mime || "audio/webm" }),
    `recording.${extensionForMime(mime)}`,
  );
  const file = await sonioxFetch("/v1/files", { method: "POST", body: form });
  const fileId = String(file.id || "");
  if (!fileId) throw new Error("Soniox did not return a file id");

  try {
    const tr = await sonioxFetch("/v1/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        model: MODEL,
        language_hints: LANGUAGE_HINTS,
        translation: { type: "one_way", target_language: TARGET_LANGUAGE },
        client_reference_id: `groundiq-${Date.now()}`,
      }),
    });
    const transcriptionId = String(tr.id || "");
    if (!transcriptionId) throw new Error("Soniox did not return a transcription id");
    return { fileId, transcriptionId };
  } catch (e) {
    // Do not leave an orphan file behind when the transcription request fails.
    await sonioxFetch(`/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE" })
      .catch(() => null);
    throw e;
  }
}

function cleanText(s: unknown): string {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** One status check. When completed, fetches and joins the transcript tokens. */
export async function pollSonioxTranscription(
  transcriptionId: string,
): Promise<SonioxResult> {
  if (!transcriptionId) return { status: "error", error: "Missing transcription id" };
  const info = await sonioxFetch(
    `/v1/transcriptions/${encodeURIComponent(transcriptionId)}`,
  );
  const status = String(info.status || "processing");
  if (status === "error") {
    return {
      status,
      error: String(
        info.error_message || info.error_type || "Soniox transcription failed",
      ),
    };
  }
  if (status !== "completed") return { status };

  const data = await sonioxFetch(
    `/v1/transcriptions/${encodeURIComponent(transcriptionId)}/transcript`,
  );
  const tokens = Array.isArray(data.tokens)
    ? (data.tokens as Record<string, unknown>[])
    : [];
  const translated: string[] = [];
  const original: string[] = [];
  for (const t of tokens) {
    const text = String(t.text || "");
    if (!text) continue;
    const kind = String(t.translation_status || "none");
    if (kind === "translation") translated.push(text);
    else original.push(text);
  }
  const transcript = cleanText(translated.join(""));
  const source = cleanText(original.join(""));
  return {
    status: "completed",
    transcript: transcript || source,
    transcriptOriginal: source || transcript,
  };
}

/** Best-effort cleanup of the uploaded audio after a stored transcript. */
export async function deleteSonioxFile(fileId: string): Promise<void> {
  if (!fileId) return;
  await sonioxFetch(`/v1/files/${encodeURIComponent(fileId)}`, { method: "DELETE" })
    .catch(() => null);
}

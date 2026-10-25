/**
 * Strip a data URL header, including MIME parameters such as
 * `data:audio/webm;codecs=opus;base64,...` (MediaRecorder Opus).
 */
export function splitDataUrl(raw: string): { mime: string; b64: string } {
  const s = String(raw || "").trim();
  if (!/^data:/i.test(s)) return { mime: "", b64: s };
  const comma = s.indexOf(",");
  if (comma < 0) return { mime: "", b64: s };
  const header = s.slice(5, comma);
  const payload = s.slice(comma + 1);
  const mime = header.split(";").map((p) => p.trim()).find((p) => p.includes("/")) || "";
  return { mime, b64: payload };
}

/** Decode base64 (optionally data-URL stripped already) → bytes */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let clean = String(b64 || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4;
  if (pad) clean += "=".repeat(4 - pad);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** True if bytes start with a known image magic (JPEG/PNG/GIF/WebP/AVIF) */
export function isImageBytes(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.length < 8) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return bytes.length >= 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return true;
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/** Hex encode ArrayBuffer / Uint8Array */
export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const enc =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
}

export async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  msg: string,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}


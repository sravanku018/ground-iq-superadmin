import {
  hmacSha256,
  sha256Hex,
  toHex,
} from "./bytes.ts";

/**
 * Cloudflare R2 PutObject (S3-compatible, SigV4).
 *
 * Bucket endpoint (this project):
 *   https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com/election-survey-media
 *
 * Env:
 *   R2_ACCOUNT_ID / R2_ENDPOINT   (defaults filled below)
 *   R2_BUCKET                     (default: election-survey-media)
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  (required for upload)
 *   R2_PUBLIC_URL                 (public r2.dev or custom domain — required to open files)
 *
 * Free tier: 10 GB storage / month.
 */
export const R2_DEFAULT_ACCOUNT_ID = "6f54ac7c46cba07b9dac5e1548348f4f";
export const R2_DEFAULT_BUCKET = "election-survey-media";
export const R2_DEFAULT_ENDPOINT =
  `https://${R2_DEFAULT_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export function r2Config(): {
  acc: string;
  host: string;
  buck: string;
  ak: string;
  sk: string;
  publicBase: string;
} {
  // Full endpoint like https://<account>.r2.cloudflarestorage.com  (optional /bucket)
  const endpointRaw = (
    Deno.env.get("R2_ENDPOINT") ||
    Deno.env.get("CLOUDFLARE_R2_ENDPOINT") ||
    R2_DEFAULT_ENDPOINT
  ).trim().replace(/\/$/, "");

  let accFromEndpoint = "";
  let hostFromEndpoint = "";
  try {
    const u = new URL(endpointRaw);
    hostFromEndpoint = u.host; // e.g. 6f54….r2.cloudflarestorage.com
    const m = hostFromEndpoint.match(/^([a-f0-9]+)\.r2\.cloudflarestorage\.com$/i);
    if (m) accFromEndpoint = m[1];
  } catch {
    /* ignore */
  }

  const accountId = (Deno.env.get("R2_ACCOUNT_ID") || "").trim();
  const accessKey = (Deno.env.get("R2_ACCESS_KEY_ID") || "").trim();
  const secretKey = (Deno.env.get("R2_SECRET_ACCESS_KEY") || "").trim();
  const bucket = (Deno.env.get("R2_BUCKET") || "").trim();
  let publicBase = (Deno.env.get("R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const acc =
    accountId ||
    (Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "").trim() ||
    accFromEndpoint ||
    R2_DEFAULT_ACCOUNT_ID;
  const ak = accessKey || (Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") || "").trim();
  const sk = secretKey || (Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") || "").trim();
  const buck =
    bucket ||
    (Deno.env.get("CLOUDFLARE_R2_BUCKET") || "").trim() ||
    R2_DEFAULT_BUCKET;
  publicBase =
    publicBase ||
    (Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL") || "").trim().replace(/\/$/, "");

  const host = hostFromEndpoint || `${acc}.r2.cloudflarestorage.com`;
  return { acc, host, buck, ak, sk, publicBase };
}

/**
 * Optional key namespace (e.g. `staging/`) so a second environment can share
 * the media bucket without mixing objects. Empty in production.
 */
export function r2KeyPrefix(): string {
  const prefix = (Deno.env.get("R2_KEY_PREFIX") || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/` : "";
}

/**
 * Object key from any stored media URL: the r2.dev public URL, the S3
 * endpoint URL, a bare key, or (via meta.key) a direct-upload row whose url
 * is the authenticated API path.
 */
export function objectKeyFromUrl(urlOrKey: string): string {
  const raw = String(urlOrKey || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    // /api/media/:id/file is not an object key — callers fall back to meta.key.
    if (raw.startsWith("/api/")) return "";
    return raw.replace(/^\//, "");
  }
  try {
    const u = new URL(raw);
    let path = decodeURIComponent(u.pathname).replace(/^\//, "");
    const { buck } = r2Config();
    if (path.startsWith(`${buck}/`)) path = path.slice(buck.length + 1);
    return path;
  } catch {
    return "";
  }
}

/** Presigned PUT URL — the browser uploads bytes straight to R2. */
export async function presignPut(
  objectKey: string,
  contentType: string,
  expiresSeconds = 900,
  bucket?: string,
): Promise<string | null> {
  const { host, buck, ak, sk } = r2Config();
  const useBucket = bucket || buck;
  const mime = String(contentType || "").trim();
  if (!ak || !sk || !objectKey || !mime) return null;
  const ttl = Math.min(Math.max(Math.floor(expiresSeconds) || 900, 60), 3600);
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const signedHeaders = "content-type;host";
  const canonicalQuery = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(`${ak}/${scope}`)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${ttl}`,
    `X-Amz-SignedHeaders=${encodeURIComponent(signedHeaders)}`,
  ].join("&");
  const canonicalHeaders = `content-type:${mime}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    `/${useBucket}/${pathKey}`,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + sk), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  return `https://${host}/${useBucket}/${pathKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Verify an uploaded object and read its true size without exposing the
 * bucket. Uses a 1-byte ranged GET on a short presigned URL.
 */
export async function objectInfo(
  objectKey: string,
  bucket?: string,
): Promise<{ size: number; mime: string; head: Uint8Array<ArrayBuffer> } | null> {
  const signed = await presignGet(objectKey, 60, bucket);
  if (!signed) return null;
  try {
    // One small ranged GET gives the true size and enough magic bytes to
    // reject a non-image uploaded as a photo. Never downloads whole media.
    const res = await fetch(signed, { headers: { Range: "bytes=0-511" } });
    if (!res.ok) return null;
    const range = res.headers.get("content-range") || "";
    const total = range.includes("/")
      ? Number(range.split("/")[1])
      : Number(res.headers.get("content-length") || 0);
    const mime = res.headers.get("content-type") || "";
    const head = new Uint8Array(await res.arrayBuffer());
    return { size: Number.isFinite(total) ? total : 0, mime, head };
  } catch {
    return null;
  }
}

/** Delete one R2 object (SigV4 DELETE). 404 counts as success. */
export async function deleteR2Object(
  objectKey: string,
  bucket?: string,
): Promise<boolean> {
  const { host, buck, ak, sk } = r2Config();
  const useBucket = bucket || buck;
  if (!ak || !sk || !objectKey) return false;
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = await sha256Hex(new Uint8Array());
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "DELETE",
    `/${useBucket}/${pathKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + sk), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const res = await fetch(`https://${host}/${useBucket}/${pathKey}`, {
      method: "DELETE",
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        Authorization: authorization,
      },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}



/** Presigned GET URL computed locally (SigV4 query signing — no API call). */
export async function presignGet(
  objectKey: string,
  expiresSeconds = 1800,
  bucket?: string,
): Promise<string | null> {
  const { host, buck, ak, sk } = r2Config();
  const useBucket = bucket || buck;
  if (!ak || !sk || !objectKey) return null;
  const ttl = Math.min(Math.max(Math.floor(expiresSeconds) || 1800, 60), 86400);
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const amzDate =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalQuery = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(`${ak}/${scope}`)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${ttl}`,
    `X-Amz-SignedHeaders=host`,
  ].join("&");
  const canonicalRequest = [
    "GET",
    `/${useBucket}/${pathKey}`,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + sk), dateStamp);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  return `https://${host}/${useBucket}/${pathKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function uploadToCloudflareR2(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  objectKey: string,
  bucketOverride?: string,
): Promise<{ url: string; provider: string } | null> {
  const cfg = r2Config();
  const { acc, host, ak, sk, publicBase } = cfg;
  const buck = bucketOverride || cfg.buck;

  // Keys + public base required; account/bucket have project defaults
  if (!acc || !ak || !sk || !buck || !publicBase) {
    if (!ak || !sk) {
      console.warn("[r2] skip: missing R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
    } else if (!publicBase) {
      console.warn(
        "[r2] skip: set R2_PUBLIC_URL (r2.dev public link), e.g. https://pub-xxxxx.r2.dev",
      );
    }
    return null;
  }

  const region = "auto";
  const pathKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const url = `https://${host}/${buck}/${pathKey}`;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const amz =
    `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const payloadHash = await sha256Hex(bytes);
  const canonicalHeaders =
    `content-type:${mime}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amz}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    `/${buck}/${pathKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(
    new TextEncoder().encode("AWS4" + sk),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Do not set Host header manually — Deno/fetch sets it from the URL (must match signed host)
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      Authorization: authorization,
    },
    body: bytes,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[r2] put failed", res.status, errText.slice(0, 300));
    return null;
  }

  // Public URL for browsers (r2.dev) — not the private S3 endpoint
  const publicPath = objectKey.split("/").map(encodeURIComponent).join("/");
  return {
    url: `${publicBase}/${publicPath}`,
    provider: "cloudflare_r2",
  };
}

/**
 * Optional external upload — ONLY if already configured (never required, no card).
 * Default path is Neon (DATABASE_URL you already use) — no credit card.
 */
export async function tryOptionalExternalUpload(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
  objectKey: string,
  filename: string,
): Promise<{ url: string; provider: string } | null> {
  // Cloudflare R2 only when ALL env vars set (skip if missing — no card signup needed)
  try {
    const r2 = await uploadToCloudflareR2(bytes, mime, objectKey);
    if (r2?.url) return r2;
  } catch {
    /* ignore */
  }

  const custom = (Deno.env.get("MEDIA_UPLOAD_URL") || "").trim();
  if (!custom) return null;
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), filename);
    form.append("kind", kind);
    const key = Deno.env.get("MEDIA_UPLOAD_KEY") || "";
    const res = await fetch(custom, {
      method: "POST",
      body: form,
      headers: {
        "User-Agent": "GroundIQ-ElectionSurvey/1.6",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    const text = (await res.text()).trim();
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        const u = j.url || j.link || j.href;
        if (u) return { url: String(u), provider: "custom" };
      } catch {
        if (text.startsWith("http")) return { url: text, provider: "custom" };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Store photo/audio linked to submission.
 * DEFAULT: Neon free DB (no card) — data column + API file link.
 * OPTIONAL: R2/custom only if env already set.
 */
export async function storeMediaLinked(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  kind: string,
): Promise<{
  url: string | null;
  provider: string;
  dataB64: string | null;
  mode: "external" | "neon";
}> {
  const ext =
    kind === "photo"
      ? "jpg"
      : mime.includes("webm")
      ? "webm"
      : mime.includes("mp4")
      ? "m4a"
      : "bin";
  const day = new Date().toISOString().slice(0, 10);
  const objectKey = `${r2KeyPrefix()}election-survey/${kind}/${day}/${crypto.randomUUID()}.${ext}`;
  const filename = `esurvey-${kind}-${Date.now()}.${ext}`;

  // Prefer external ONLY if pre-configured (Cloudflare etc.) — never force signup/card
  const external = await tryOptionalExternalUpload(
    bytes,
    mime,
    kind,
    objectKey,
    filename,
  );
  if (external) {
    return {
      url: external.url,
      provider: external.provider,
      dataB64: null,
      mode: "external",
    };
  }

  // DEFAULT: Neon — no credit card, uses your existing free Neon project
  // Cap ~1.5MB binary (~2.0MB base64) to protect free tier
  if (bytes.length > 1_500_000) {
    throw new Error(
      "Media too large (max ~1.5MB). Use a smaller photo / shorter audio.",
    );
  }
  return {
    url: null, // filled after insert with /api/media/:id/file
    provider: "neon",
    dataB64: bytesToBase64(bytes),
    mode: "neon",
  };
}


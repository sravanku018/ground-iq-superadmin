import {
  CORS_HEADERS,
} from "./cors.ts";
import {
  json,
} from "./http.ts";

export const GITHUB_RELEASE_APK =
  "https://github.com/sravanku018/ground-iq-web/releases/latest/download/ElectionSurvey-release.apk";
export const LOCAL_APK_PATHS = [
  "/opt/smart-survey-x/SmartSurveyX.apk",
  "/opt/smart-survey-x/app.apk",
];
export const GITHUB_REPO = "sravanku018/ground-iq-web";

/**
 * Release numbers for this build. scripts/sync-version.mjs rewrites the two
 * literals (keep the `version:` / `versionCode:` key shape) and bumps
 * android/app/build.gradle in the same run, so the web bundle, the APK and this
 * API all carry one number.
 */
export const APP_RELEASE = {
  version: "2.0.105",
  versionCode: 20099,
  minSupportedVersionCode: 20000,
};

/**
 * Manifest describing the APK published next to this server. It is the only
 * thing trusted for "which build can a client actually download", so
 * /api/app-version can never advertise a release that /api/app.apk cannot serve
 * — the failure that left phones offering an update forever (the API said
 * 2.0.83 while the cached file on disk was 2.0.63).
 */
export const APK_SIDECAR_PATH = Deno.env.get("APK_SIDECAR_PATH") || "/opt/smart-survey-x/app-version.json";

export type ApkRelease = {
  version: string;
  versionCode: number;
  sha256?: string;
  size?: number;
  publishedAt?: string;
};

/** "2.0.83" → 20083, matching scripts/sync-version.mjs and src/appUpdate.js. */
export function versionCodeFromSemver(v: string): number {
  const p = String(v || "").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  return (p[0] || 0) * 10000 + (p[1] || 0) * 100 + Math.min(p[2] || 0, 99);
}

export async function readApkSidecar(): Promise<ApkRelease | null> {
  try {
    const raw = await Deno.readTextFile(APK_SIDECAR_PATH);
    const m = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof m?.version === "string" ? m.version.trim() : "";
    if (!/^\d+\.\d+\.\d+/.test(version)) return null;
    return {
      version,
      versionCode: Number(m?.versionCode) || versionCodeFromSemver(version),
      sha256: typeof m?.sha256 === "string" ? m.sha256 : undefined,
      size: Number(m?.size) || undefined,
      publishedAt: typeof m?.publishedAt === "string" ? m.publishedAt : undefined,
    };
  } catch {
    return null; // absent or unreadable — the caller falls back
  }
}

export let ghLatestCache: { version: string; at: number } | null = null;

/** Latest published GitHub release tag — the trusted artifact when no manifest exists. */
export async function githubLatestVersion(): Promise<string | null> {
  if (ghLatestCache && Date.now() - ghLatestCache.at < 600_000) return ghLatestCache.version;
  let version: string | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SmartSurveyX-API" },
    });
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      const tag = String(j?.tag_name || "").replace(/^v/, "");
      if (/^\d+\.\d+\.\d+/.test(tag)) version = tag;
    }
  } catch {
    version = null;
  }
  ghLatestCache = { version, at: Date.now() };
  return version;
}

/**
 * What a client will actually receive: the published APK's manifest when it
 * exists, else the latest published release, else this build's compiled number.
 */
export async function servedApkRelease(): Promise<ApkRelease> {
  const sidecar = await readApkSidecar();
  if (sidecar) return sidecar;
  const gh = await githubLatestVersion();
  if (gh) return { version: gh, versionCode: versionCodeFromSemver(gh) };
  return { version: APP_RELEASE.version, versionCode: APP_RELEASE.versionCode };
}

/** Persist the manifest for the APK we just cached, so advert and file agree. */
export async function writeApkSidecar(bytes: Uint8Array): Promise<void> {
  try {
    const gh = await githubLatestVersion();
    const version = gh || APP_RELEASE.version;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const info: ApkRelease = {
      version,
      versionCode: versionCodeFromSemver(version),
      sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      size: bytes.byteLength,
      publishedAt: new Date().toISOString(),
    };
    await Deno.writeTextFile(APK_SIDECAR_PATH, JSON.stringify(info, null, 2) + "\n");
  } catch {
    /* best-effort — without it the advert falls back to GitHub's tag */
  }
}

export function apkHeaders(byteLength?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/vnd.android.package-archive",
    "content-disposition": 'attachment; filename="SmartSurveyX.apk"',
    "cache-control": "no-store, no-cache, must-revalidate",
    "x-content-type-options": "nosniff",
    ...CORS_HEADERS,
    "access-control-allow-origin": "*",
  };
  if (byteLength != null && byteLength > 0) headers["content-length"] = String(byteLength);
  return headers;
}

export function isZipApk(bytes: Uint8Array): boolean {
  return bytes.length > 100_000 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function apkFileResponse(method: string, file: Uint8Array): Response {
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: apkHeaders(file.byteLength) });
  }
  return new Response(file, { status: 200, headers: apkHeaders(file.byteLength) });
}

/** Fetch the published release, and (optionally) cache it with a fresh manifest. */
export async function proxyPublishedApk(method: string, cache: boolean): Promise<Response> {
  const upstream = await fetch(GITHUB_RELEASE_APK, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 SmartSurveyX-APK",
      Accept: "application/vnd.android.package-archive,application/octet-stream,*/*",
    },
  });
  if (!upstream.ok) {
    return json({ error: "App download is temporarily unavailable" }, 502);
  }
  const buf = new Uint8Array(await upstream.arrayBuffer());
  if (!isZipApk(buf)) {
    return json({ error: "App package is invalid. Use the PWA web app instead." }, 502);
  }
  if (cache) {
    Deno.writeFile(LOCAL_APK_PATHS[0], buf).catch(() => null);
    await writeApkSidecar(buf);
  }
  return apkFileResponse(method, buf);
}

/** Direct APK file for phones. Never serve HTML as APK, never serve an unverified build. */
export async function serveAppApk(method: string): Promise<Response> {
  try {
    const manifest = await readApkSidecar();

    if (manifest) {
      // A published manifest makes the on-disk APK trustworthy — and its size
      // proves the file is the one that was published, not a half-written leftover.
      for (const p of LOCAL_APK_PATHS) {
        try {
          const file = await Deno.readFile(p);
          if (!isZipApk(file)) continue;
          if (manifest.size && file.byteLength !== manifest.size) {
            console.error(`apk: ${p} (${file.byteLength}B) does not match manifest ${manifest.version} (${manifest.size}B)`);
            continue;
          }
          return apkFileResponse(method, file);
        } catch {
          /* try next path */
        }
      }
      console.error(`apk: manifest ${manifest.version} has no matching file — serving the release uncached`);
      return await proxyPublishedApk(method, false);
    }

    // No manifest: an on-disk copy cannot be identified, so it may be an old
    // release (that is exactly how the stale 2.0.63 file shadowed every newer
    // build). Fetch the published artifact and describe what we cached.
    return await proxyPublishedApk(method, true);
  } catch (err) {
    console.error("apk proxy:", err);
    return json({ error: "App download failed" }, 502);
  }
}


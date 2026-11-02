/**
 * In-app APK update: compare /api/app-version, then download+install
 * inside the Android WebView (no browser).
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { APP_VERSION, APP_VERSION_CODE } from "./version"
import { apkDownloadUrl, appIdentityHeaders, getApiBase } from "./api"

const GITHUB_REPO = "sravanku018/ground-iq-web"
const DISMISSED_UPDATE_KEY = "esurvey_dismissed_update_version"

const ApkInstall = registerPlugin('ApkInstall')

/** Native APK vs PWA/web. The mandatory update gate only applies natively. */
export function isNativeApp() {
  return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform?.()
}

// The sync engine may ask on every drain; cache the version response briefly.
let apiVersionCache = null
let apiVersionCacheAt = 0

export function semverCompare(a, b) {
  const pa = String(a || "0").replace(/^v/, "").split(".").map(Number)
  const pb = String(b || "0").replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

function defaultApkUrl() {
  return apkDownloadUrl()
}

/**
 * Check if a newer version of the APK is available.
 * The VPS /api/app-version is authoritative (it self-heals against the
 * published GitHub release), so the browser never calls api.github.com —
 * that would be blocked by the production CSP and is redundant.
 */
export async function checkForAppUpdate(options = { ignoreDismissed: false }) {
  let apiData = null

  try {
    const now = Date.now()
    if (!options.force && apiVersionCache && now - apiVersionCacheAt < 60_000) {
      apiData = apiVersionCache
    } else {
      const base = getApiBase()
      const res = await fetch(`${base}/api/app-version?t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          ...appIdentityHeaders(),
        },
      })
      if (res.ok) {
        const json = await res.json()
        if (json?.version) {
          apiData = json
          apiVersionCache = json
          apiVersionCacheAt = now
        }
      }
    }
  } catch {
    // Offline: keep the last known answer so the sync gate stays stable.
    apiData = apiVersionCache
  }

  const updateData = apiData;

  if (!updateData || !updateData.version) {
    return { hasUpdate: false, currentVersion: APP_VERSION, currentVersionCode: APP_VERSION_CODE }
  }

  const latestCode = Number(updateData.versionCode) || 0
  const codeNewer = latestCode > 0 && APP_VERSION_CODE > 0 && latestCode > APP_VERSION_CODE
  const semverNewer = semverCompare(updateData.version, APP_VERSION) > 0
  // Server-enforced floor: an APK below this code cannot dismiss the update.
  // Old APKs (before 2.0.122) ignore this field; the old host is gated server-side.
  const minCode = Number(
    updateData.minSupportedVersionCode ?? updateData.min_supported_version_code,
  ) || 0
  const belowMin = minCode > 0 && APP_VERSION_CODE > 0 && APP_VERSION_CODE < minCode
  const isNewer = codeNewer || semverNewer || belowMin

  const latest = {
    version: updateData.version,
    versionCode: latestCode,
    apkUrl: updateData.apkUrl || defaultApkUrl(),
    releaseUrl: updateData.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`,
    changelog: updateData.changelog || "Performance improvements and bug fixes.",
    mandatory: belowMin || Boolean(updateData.mandatory),
    minSupportedVersionCode: minCode || undefined,
  }

  if (!isNewer) {
    return {
      hasUpdate: false,
      currentVersion: APP_VERSION,
      currentVersionCode: APP_VERSION_CODE,
      latest,
    }
  }

  if (!options.ignoreDismissed && !latest.mandatory) {
    const dismissed = localStorage.getItem(DISMISSED_UPDATE_KEY)
    if (dismissed === updateData.version) {
      return { hasUpdate: false, dismissed: true, currentVersion: APP_VERSION, latest }
    }
  }

  return {
    hasUpdate: true,
    currentVersion: APP_VERSION,
    currentVersionCode: APP_VERSION_CODE,
    latest,
  }
}

export function dismissUpdate(version) {
  if (version) {
    localStorage.setItem(DISMISSED_UPDATE_KEY, String(version))
  }
}

/**
 * Download the APK and open the system installer inside the app.
 * Does not open Chrome / GitHub.
 */
export async function launchApkUpdate(apkUrl) {
  const target = apkUrl || defaultApkUrl()
  const native = isNativeApp()
  if (native) {
    try {
      const result = await ApkInstall.downloadAndInstall({ url: target })
      if (result?.needPermission) {
        throw new Error("Allow this app to install updates, then tap Check for Updates again.")
      }
      return result
    } catch (e) {
      // Fallback: If native package installer or permission crashes, open download URL in system browser
      console.warn("Native in-app APK install failed, falling back to browser download:", e)
      window.open(target, "_system")
      return { ok: true, fallback: true }
    }
  }
  // Browser / portal: download the file in this tab
  const a = document.createElement("a")
  a.href = target
  a.download = "ElectionSurvey-release.apk"
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}

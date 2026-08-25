/**
 * In-App OTA Update Checker (Telegram-style)
 * Checks server / GitHub releases for newer APK version and prompts installation.
 */

import { APP_VERSION, APP_VERSION_CODE } from "./version"
import { getApiBase } from "./api"

const GITHUB_REPO = "sravanku018/ground-iq-web"
const DISMISSED_UPDATE_KEY = "esurvey_dismissed_update_version"

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

/**
 * Check if a newer version of the APK is available.
 */
export async function checkForAppUpdate(options = { ignoreDismissed: false }) {
  let updateData = null

  // 1. Try Deno Deploy /api/app-version first
  try {
    const base = getApiBase()
    const res = await fetch(`${base}/api/app-version`, { cache: "no-cache" })
    if (res.ok) {
      updateData = await res.json()
    }
  } catch {
    // Fallback to GitHub Releases API
  }

  // 2. Fallback to GitHub Releases API
  if (!updateData) {
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      if (ghRes.ok) {
        const ghData = await ghRes.json()
        const tag = (ghData.tag_name || "").replace(/^v/, "")
        const apkAsset = (ghData.assets || []).find((a) => a.name.endsWith(".apk"))
        updateData = {
          version: tag,
          apkUrl: apkAsset ? apkAsset.browser_download_url : `https://github.com/${GITHUB_REPO}/releases/latest/download/ElectionSurvey-release.apk`,
          releaseUrl: ghData.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
          changelog: ghData.body || "New performance & security updates available.",
        }
      }
    } catch {
      // Offline / network failure
    }
  }

  if (!updateData || !updateData.version) {
    return { hasUpdate: false }
  }

  const latestCode = Number(updateData.versionCode) || 0
  const isNewer =
    (latestCode > 0 && APP_VERSION_CODE > 0 && latestCode > APP_VERSION_CODE) ||
    semverCompare(updateData.version, APP_VERSION) > 0

  if (!isNewer) {
    return { hasUpdate: false, latest: updateData }
  }

  if (!options.ignoreDismissed) {
    const dismissed = localStorage.getItem(DISMISSED_UPDATE_KEY)
    if (dismissed === updateData.version) {
      return { hasUpdate: false, dismissed: true, latest: updateData }
    }
  }

  return {
    hasUpdate: true,
    currentVersion: APP_VERSION,
    currentVersionCode: APP_VERSION_CODE,
    latest: {
      version: updateData.version,
      versionCode: latestCode,
      apkUrl: updateData.apkUrl || `https://github.com/${GITHUB_REPO}/releases/latest/download/ElectionSurvey-release.apk`,
      releaseUrl: updateData.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`,
      changelog: updateData.changelog || "Performance improvements and bug fixes.",
      mandatory: Boolean(updateData.mandatory),
    },
  }
}

/**
 * Dismiss update notification until a newer version comes out
 */
export function dismissUpdate(version) {
  if (version) {
    localStorage.setItem(DISMISSED_UPDATE_KEY, String(version))
  }
}

/**
 * Download & launch APK installer on Android or open browser download link
 */
export function launchApkUpdate(apkUrl) {
  const target = apkUrl || `https://github.com/${GITHUB_REPO}/releases/latest/download/ElectionSurvey-release.apk`
  try {
    if (typeof window !== "undefined") {
      const win = window.open(target, "_system"); if (!win) { window.open(target, "_blank"); }
    }
  } catch {
    window.location.href = target
  }
}

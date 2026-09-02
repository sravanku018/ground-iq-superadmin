/**
 * In-app APK update: compare /api/app-version, then download+install
 * inside the Android WebView (no browser).
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { APP_VERSION, APP_VERSION_CODE } from "./version"
import { apkDownloadUrl, getApiBase } from "./api"

const GITHUB_REPO = "sravanku018/ground-iq-web"
const DISMISSED_UPDATE_KEY = "esurvey_dismissed_update_version"

const ApkInstall = registerPlugin('ApkInstall')

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
 */
function pickNewer(a, b) {
  if (a && !b) return a
  if (b && !a) return b
  if (!a && !b) return null
  const codeA = Number(a.versionCode) || 0
  const codeB = Number(b.versionCode) || 0
  if (codeA && codeB) return codeA >= codeB ? a : b
  return semverCompare(a.version, b.version) >= 0 ? a : b
}

export async function checkForAppUpdate(options = { ignoreDismissed: false }) {
  let apiData = null
  let ghData = null

  try {
    const base = getApiBase()
    const res = await fetch(`${base}/api/app-version?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    })
    if (res.ok) {
      const json = await res.json()
      if (json?.version) apiData = json
    }
  } catch {
    /* GitHub still tried below */
  }

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest?t=${Date.now()}`,
      { cache: "no-store", headers: { Accept: "application/vnd.github+json" } },
    )
    if (ghRes.ok) {
      const latest = await ghRes.json()
      const tag = (latest.tag_name || "").replace(/^v/, "")
      const apkAsset = (latest.assets || []).find((a) => /\.apk$/i.test(a.name || ""))
      if (tag) {
        ghData = {
          version: tag,
          versionCode: (() => {
            const p = tag.split(".").map((n) => Number(n) || 0)
            return (p[0] || 0) * 10000 + (p[1] || 0) * 100 + Math.min(p[2] || 0, 99)
          })(),
          apkUrl: apkAsset ? apkAsset.browser_download_url : defaultApkUrl(),
          releaseUrl: latest.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
          changelog: latest.body || "New performance & security updates available.",
        }
      }
    }
  } catch {
    /* offline */
  }

  const updateData = pickNewer(apiData, ghData)

  if (!updateData || !updateData.version) {
    return { hasUpdate: false, currentVersion: APP_VERSION, currentVersionCode: APP_VERSION_CODE }
  }

  const latestCode = Number(updateData.versionCode) || 0
  const codeNewer = latestCode > 0 && APP_VERSION_CODE > 0 && latestCode > APP_VERSION_CODE
  const semverNewer = semverCompare(updateData.version, APP_VERSION) > 0
  const isNewer = codeNewer || semverNewer

  const latest = {
    version: updateData.version,
    versionCode: latestCode,
    apkUrl: updateData.apkUrl || defaultApkUrl(),
    releaseUrl: updateData.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`,
    changelog: updateData.changelog || "Performance improvements and bug fixes.",
    mandatory: Boolean(updateData.mandatory),
  }

  if (!isNewer) {
    return {
      hasUpdate: false,
      currentVersion: APP_VERSION,
      currentVersionCode: APP_VERSION_CODE,
      latest,
    }
  }

  if (!options.ignoreDismissed) {
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
  const native = typeof Capacitor !== "undefined" && Capacitor.isNativePlatform?.()
  if (native) {
    const result = await ApkInstall.downloadAndInstall({ url: target })
    if (result?.needPermission) {
      throw new Error("Allow this app to install updates, then tap Check for Updates again.")
    }
    return result
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

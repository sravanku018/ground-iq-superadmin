#!/usr/bin/env node
/**
 * Publish a built release APK to the Smart Survey X server.
 *
 * Copies the APK and its release manifest (app-version.json) next to the API.
 * /api/app-version reports the manifest, so the advertised release can never run
 * ahead of the APK that /api/app.apk actually serves — a stale or missing
 * manifest made every phone chase an update it could not install.
 *
 * Usage:
 *   npm run build:apk:release && npm run publish:apk
 *   node scripts/publish-apk.mjs --dry-run
 *
 * Env overrides:
 *   VPS_HOST  (default root@162.35.96.65)
 *   VPS_KEY   (default "<home>/Downloads/vps oracle/id_ed25519")
 *   APK_FILE  (default android/app/build/outputs/apk/release/app-release.apk)
 *   REMOTE_DIR(default /opt/smart-survey-x)
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dry = process.argv.includes('--dry-run')

const host = process.env.VPS_HOST || 'root@162.35.96.65'
const key = process.env.VPS_KEY || path.join(os.homedir(), 'Downloads', 'vps oracle', 'id_ed25519')
const remoteDir = process.env.REMOTE_DIR || '/opt/smart-survey-x'
const apkPath = path.resolve(
  root,
  process.env.APK_FILE || 'android/app/build/outputs/apk/release/app-release.apk',
)

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = String(pkg.version || '')
const versionCode = Number(pkg.versionCode) || 0
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`package.json version "${version}" is not x.y.z — run npm run version:sync first`)
  process.exit(1)
}

if (!fs.existsSync(apkPath)) {
  console.error(`No APK at ${apkPath}\nBuild one first: npm run build:apk:release`)
  process.exit(1)
}

const bytes = fs.readFileSync(apkPath)
// Guard against shipping an HTML error page or a truncated file as an "APK".
if (!(bytes.length > 100_000 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
  console.error(`${apkPath} is not a valid APK archive (${bytes.length} bytes)`)
  process.exit(1)
}

const manifest = {
  version,
  versionCode,
  size: bytes.length,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  publishedAt: new Date().toISOString(),
}

const manifestPath = path.join(os.tmpdir(), `smax-app-version-${version}.json`)
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`Publishing ${path.basename(apkPath)}`)
console.log(`  version   : ${version} (${versionCode})`)
console.log(`  size      : ${manifest.size} bytes`)
console.log(`  sha256    : ${manifest.sha256}`)
console.log(`  target    : ${host}:${remoteDir}/SmartSurveyX.apk + app-version.json`)

const sshArgs = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']

if (dry) {
  console.log('\n--dry-run: nothing copied.')
  process.exit(0)
}

// Upload under temp names, then swap both into place so a download can never see
// a new APK with an old manifest (or the reverse).
const stamp = Date.now()
const tmpApk = `${remoteDir}/.apk-upload-${stamp}`
const tmpManifest = `${remoteDir}/.apk-manifest-${stamp}.json`

execFileSync('ssh', [...sshArgs, host, `cat > ${tmpApk}`], { input: bytes, stdio: ['pipe', 'inherit', 'inherit'] })
execFileSync('ssh', [...sshArgs, host, `cat > ${tmpManifest}`], {
  input: fs.readFileSync(manifestPath),
  stdio: ['pipe', 'inherit', 'inherit'],
})
execFileSync(
  'ssh',
  [
    ...sshArgs,
    host,
    [
      `mv ${tmpApk} ${remoteDir}/SmartSurveyX.apk`,
      `mv ${tmpManifest} ${remoteDir}/app-version.json`,
      `chmod 644 ${remoteDir}/SmartSurveyX.apk ${remoteDir}/app-version.json`,
      `ls -la ${remoteDir}/SmartSurveyX.apk ${remoteDir}/app-version.json`,
    ].join(' && '),
  ],
  { stdio: 'inherit' },
)

console.log(`\nDone. /api/app-version now advertises ${version} and /api/app.apk serves it.`)
console.log('Phones on any older build will be offered this update in-app.')

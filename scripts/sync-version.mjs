#!/usr/bin/env node
/**
 * Push package.json version into:
 *   - Android build.gradle (versionName + versionCode)
 *   - the API's /api/app-version metadata (hono-api/legacy/handler/lib/apk.ts), which is
 *     what installed apps read to decide whether a newer release exists.
 * Usage:
 *   node scripts/sync-version.mjs           # sync only
 *   node scripts/sync-version.mjs --bump    # patch bump then sync
 *   node scripts/sync-version.mjs --minor
 *   node scripts/sync-version.mjs --major
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')
const gradlePath = path.join(root, 'android', 'app', 'build.gradle')
const apiHandlerPath = path.join(root, 'hono-api', 'legacy', 'handler', 'lib', 'apk.ts')

function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) throw new Error(`Invalid semver: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3] }
}

function toVersionCode({ major, minor, patch }) {
  // 1.6.2 → 10602 (max patch 99)
  return major * 10000 + minor * 100 + Math.min(patch, 99)
}

function bump(ver, kind) {
  const s = parseSemver(ver)
  if (kind === 'major') return `${s.major + 1}.0.0`
  if (kind === 'minor') return `${s.major}.${s.minor + 1}.0`
  return `${s.major}.${s.minor}.${s.patch + 1}`
}

const args = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))

let version = pkg.version || '1.0.0'
if (args.includes('--major')) version = bump(version, 'major')
else if (args.includes('--minor')) version = bump(version, 'minor')
else if (args.includes('--bump') || args.includes('--patch')) version = bump(version, 'patch')

const parts = parseSemver(version)
const versionCode = pkg.versionCode && !args.some((a) => a.startsWith('--'))
  ? Number(pkg.versionCode)
  : toVersionCode(parts)

pkg.version = version
pkg.versionCode = versionCode
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8')
  if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]+"/.test(gradle)) {
    console.error('Could not find versionCode/versionName in android/app/build.gradle')
    process.exit(1)
  }
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`)
  fs.writeFileSync(gradlePath, gradle)
  console.log(`Synced Android: versionName=${version} versionCode=${versionCode}`)
} else {
  console.warn('android/app/build.gradle not found — package.json only')
}

// /api/app-version is a plain string constant in the API source. If it isn't
// bumped with the app, installed clients keep seeing an old "latest" release.
if (fs.existsSync(apiHandlerPath)) {
  let api = fs.readFileSync(apiHandlerPath, 'utf8')
  const versionRe = /(\bversion:\s*")\d+\.\d+\.\d+(")/
  const versionCodeRe = /(\bversionCode:\s*)\d+/
  if (!versionRe.test(api) || !versionCodeRe.test(api)) {
    console.error('Could not find version/versionCode in hono-api/legacy/handler/lib/apk.ts')
    process.exit(1)
  }
  api = api.replace(versionRe, `$1${version}$2`)
  api = api.replace(versionCodeRe, `$1${versionCode}`)
  fs.writeFileSync(apiHandlerPath, api)
  console.log(`Synced API: version=${version} versionCode=${versionCode}`)
} else {
  console.warn('hono-api/legacy/handler/lib/apk.ts not found — API version not synced')
}

console.log(`package.json version=${version} versionCode=${versionCode}`)

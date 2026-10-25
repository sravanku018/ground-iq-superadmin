#!/usr/bin/env node
/**
 * One-command release for every target EXCEPT the website.
 *
 * The website (portal + surveyor SPA) needs no step here: pushing to main makes
 * Vercel and GitHub Pages rebuild, and the SPA reloads itself when the build
 * changes. Everything that does NOT update by itself is handled below:
 *
 *   1. bump + sync the version   package.json → android/app/build.gradle → API
 *   2. build the web bundle + the signed release APK
 *   3. publish the APK + its manifest to the API server (drives in-app updates)
 *   4. deploy the API to the server
 *   5. commit, tag, push, and cut a GitHub release with the APK attached
 *
 * Usage:
 *   npm run release                # patch bump (default); asks to confirm
 *   npm run release -- --minor
 *   npm run release -- --major
 *   npm run release -- --yes       # no prompt (unattended)
 *   npm run release -- --dry-run   # print the plan, change nothing
 *   npm run release -- --skip-api  # skip the API deploy
 *   npm run release -- --skip-build  # reuse the APK already built + published
 *   npm run release -- --no-bump   # ship the current version (finish/backfill)
 *
 * Env:
 *   VPS_DIR  (default "<home>/Downloads/vps oracle", holds push_vps.py + key)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = (name) => args.includes(`--${name}`)

const dryRun = has('dry-run')
const assumeYes = has('yes')
const skipApi = has('skip-api')
const skipBuild = has('skip-build')
const noBump = has('no-bump')
const kind = has('major') ? 'major' : has('minor') ? 'minor' : 'patch'
const vpsDir = process.env.VPS_DIR || path.join(os.homedir(), 'Downloads', 'vps oracle')

/**
 * Files the version bump rewrites. android/ is gitignored in this repo (the
 * gradle project is local-only), so only the tracked ones are ever staged.
 */
const VERSION_FILES = ['package.json', 'android/app/build.gradle', 'hono-api/legacy/handler.ts']
const RELEASE_APK = 'ElectionSurvey-release.apk'

/** Run a step, echoing it. Respects --dry-run. */
function step(cmd, cmdArgs = [], { cwd = root } = {}) {
  console.log(`\n\x1b[1m▶ ${[cmd, ...cmdArgs].join(' ')}\x1b[0m`)
  if (dryRun) return
  execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' })
}

/** Read-only query; always runs, never throws. */
function read(cmd, cmdArgs = [], cwd = root) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function nextVersion(version, bump) {
  const [major, minor, patch] = String(version).split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function versionCodeFor(version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return major * 100000 + minor * 1000 + Math.min(patch, 999)
}

// ---------------------------------------------------------------- preflight
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = noBump ? pkg.version : nextVersion(pkg.version, kind)
const versionCode = versionCodeFor(version)

/**
 * Version files that git actually tracks. android/ is gitignored here, so
 * android/app/build.gradle stays local-only and must not be staged.
 */
const trackedVersionFiles = VERSION_FILES.filter(
  (file) => fs.existsSync(path.join(root, file)) && read('git', ['ls-files', '--error-unmatch', '--', file]) !== '',
)

if (!fs.existsSync(path.join(root, 'android', 'gradlew'))) fail('android/gradlew not found — run from the app repo')
if (!fs.existsSync(path.join(root, 'scripts', 'publish-apk.mjs'))) fail('scripts/publish-apk.mjs not found')
if (read('git', ['tag', '--list', version]) === version) fail(`tag ${version} already exists`)
if (!skipApi && !fs.existsSync(path.join(vpsDir, 'push_vps.py'))) {
  fail(`push_vps.py not found in ${vpsDir} — set VPS_DIR or pass --skip-api`)
}

const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main'
const upstream = read('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
const remote = upstream.includes('/') ? upstream.split('/')[0] : 'ground-iq'

console.log(`\nSmart Survey X release`)
console.log(`  version   : ${noBump ? `${version} (no bump)` : `${pkg.version} → ${version}`} (${versionCode})`)
console.log(`  branch    : ${branch} → ${remote}`)
console.log(`  artifacts : ${skipBuild ? 'reuse existing APK + manifest' : 'build APK + publish to server'}`)
console.log(`  api deploy: ${skipApi ? 'skipped' : vpsDir}`)
console.log(`  website   : not touched (rebuilds by itself on push)`)
if (dryRun) console.log(`  mode      : DRY RUN — nothing will change`)

// ------------------------------------------------------------ confirmation
if (!dryRun && !assumeYes) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`\nRelease v${version}? [y/N] `)
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Aborted. Nothing changed.')
    process.exit(1)
  }
}

// ------------------------------------------------------------- 1. bump/sync
step('node', noBump ? ['scripts/sync-version.mjs'] : ['scripts/sync-version.mjs', `--${kind}`])

// ------------------------------------------------------- 2. build + publish
const apkPath = path.join(root, RELEASE_APK)
if (!skipBuild) {
  step('npm', ['run', 'build:apk:release'])
  if (!dryRun) {
    if (!fs.existsSync(apkPath)) fail(`${RELEASE_APK} was not produced by the build`)
    console.log(`\n✔ APK built (${fs.statSync(apkPath).size} bytes)`)
  }
  step('npm', ['run', 'publish:apk'])
}
if (!dryRun && !fs.existsSync(apkPath)) fail(`${RELEASE_APK} not found — drop --skip-build`)

// ------------------------------------------------------------- 3. API deploy
if (!skipApi) step('python3', ['push_vps.py', '--service', 'survey'], { cwd: vpsDir })

// ----------------------------------------------------------- 4. git + GitHub
if (!trackedVersionFiles.length) fail('no tracked version files to commit')
step('git', ['add', ...trackedVersionFiles])
if (read('git', ['diff', '--cached', '--name-only'])) {
  step('git', ['commit', '-m', `Bump version to v${version} (versionCode ${versionCode})`])
} else {
  console.log('\n(version files already committed — nothing to commit)')
}
step('git', ['tag', version])
step('git', ['push', remote, branch])
step('git', ['push', remote, version])
step('gh', ['release', 'create', version, apkPath, '--title', `v${version}`, '--generate-notes'])

console.log(`\n✔ Released v${version} (${versionCode})`)
console.log(`  · in-app update  : phones on older builds are offered ${version}`)
console.log(`  · android channel: ${remote} tag ${version} + APK asset`)
console.log(`  · website        : updates itself from the ${branch} push`)
if (dryRun) console.log('\n(dry run — nothing was changed)')

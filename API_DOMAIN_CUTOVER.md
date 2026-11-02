# API domain cutover — api.smartsurveyx.com

Status: **prepared on branch `api-domain-cutover`; not deployed.** Election-week
freeze applies until the operator says go.

## Current facts (verified)

- `ss -tlnp`: Deno listens on **127.0.0.1:8000** only; Caddy owns `*:80` / `*:443`.
- UFW: active, default deny incoming; only 22, 80, 443, 2222 are allowed. Port 8000 is not exposed.
- DNS is Vercel (`ns1/ns2.vercel-dns.com`). `api.smartsurveyx.com` has an **explicit A**
  record to Vercel (`216.198.79.65`, `64.29.17.65`); the wildcard uses different IPs
  (`.1`). TLS on the `api` host currently fails, so it is not serving a live app.
- WebAuthn uses the **page origin**: `window.location.origin` → server
  `webauthnOrigin()` allowlist → `webauthnRpId(origin) = hostname`.
  Allowed: `https://smartsurveyx.com`, `https://www.smartsurveyx.com`, `https://localhost`
  (APK), localhost dev ports, GitHub Pages. The API hostname is not involved, so passkeys
  survive the API move; `rpId` stays `www.smartsurveyx.com` / `localhost`.
- `/api/app-version` already returns `minSupportedVersionCode` (currently `20000`).
  The client before 2.0.122 ignores it; 2.0.122 will treat a below-min APK as mandatory.

## Step 1 — DNS (operator action)

Replace the existing `api` record in Vercel DNS with:

```
Type: A
Name: api
Value: 162.35.96.65
TTL: 300
Proxy: n/a (Vercel DNS is authoritative, not a proxy)
```

Verify:

```bash
dig +short A api.smartsurveyx.com     # must print 162.35.96.65
```

Do this **before** loading the Caddy block: Caddy uses HTTP-01 and will fail issuance
while the name still points at Vercel.

## Step 2 — Caddy (old host untouched)

Copy `ops/caddy/api.smartsurveyx.com.caddy` into `/etc/caddy/Caddyfile`, keep the
existing `162.35.96.65.sslip.io` block, then:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
sleep 5
curl -sS https://api.smartsurveyx.com/api/health
curl -sSI https://api.smartsurveyx.com/api/health | grep -iE 'strict-transport|content-security|x-frame'
```

Both hosts must answer. Do not redirect old → new.

## Step 3 — web (prepared on this branch, deploy after freeze)

Files changed on the branch:

| File | Change |
|---|---|
| `.env.production` | `VITE_API_BASE_URL=https://api.smartsurveyx.com` |
| `src/api.js` | `DENO_API_URL` → new host |
| `index.html` | preconnect/dns-prefetch added for new host; old kept |
| `public/landing.html` | contact form API base → new host |
| `vercel.json` | CSP `connect-src` includes **both** hosts; `report-uri` lists **both** CSP report endpoints |

`report-uri` value used on every CSP route:

```
report-uri https://162.35.96.65.sslip.io/api/csp-report https://api.smartsurveyx.com/api/csp-report
```

Deploy steps after approval:

```bash
git switch api-domain-cutover
git push ground-iq api-domain-cutover:main
```

Then verify on the live site: login, media presign/GET, charts, export, notification
stream, and both CSP report endpoints.

## Step 4 — APK 2.0.122

- Build from the cutover branch so `.env.production` bakes in the new API host.
- `bump_version.py 2.0.122 --apk` (explicit version, do not let it bump to 2.0.123).
- Install + test: login, photo/audio presign, offline queue, update check.
- Old APKs keep calling `162.35.96.65.sslip.io`; keep that host and its certificate.

## Step 5 — traffic visibility (no gate, no retirement date)

Old APKs cannot handle `426 Upgrade Required`; a forced gate would also burn their
queued-package retry attempts. **No 426 gate and no hard upload block.**

### Traffic accounting (prepared on this branch)

- `hono-api/legacy/handler/lib/traffic.ts` batches `(day, host, app_version, requests)`
  in memory; the job worker flushes to the `app_traffic` table every tick.
- Host/version are normalized before keying: only `*.smartsurveyx.com`,
  `*.162.35.96.65.sslip.io`, `localhost`, `127.0.0.1` and semver-like versions are
  kept; everything else becomes `other`. The in-memory map is capped at 100 buckets.
- `logRequest()` includes `host` and `app_version`; new clients send
  `X-App-Version` / `X-App-Version-Code` from `src/api.js`.
- Old APKs send no version header → `app_version = "other"`; the **host** is the signal.
- `runRetentionSweep()` deletes `app_traffic` rows older than **90 days**.
- Super Admin report: `GET /api/app-traffic?days=30`, also shown on the Errors page:
  rows per host/version plus `old_host_requests` and `old_host_last_seen`.

### 2.0.122 update prompt (prepared on this branch)

- Never blocks `drainQueue`: the prompt is advisory, shown **only when the user taps
  Sync**; uploads continue normally.
- Capture, drafts and queueing are unaffected; background sync is never gated.
- “Keep collecting offline” closes the prompt.
- A failed download keeps the prompt with **Retry** and a direct APK link; closing it
  never strands the user.
- A global **“N waiting to sync”** bar appears on non-home tabs whenever packages are
  queued, so a failed/offline sync is always visible.

### Retirement

**The sslip host stays live. No retirement date.** The traffic report is for visibility
only; removal happens only on an explicit operator decision after reviewing old-host
usage.

## Version codes

Formula: `major * 100000 + minor * 1000 + min(patch, 999)`.

| Version | versionCode |
|---|---|
| 2.0.120 | `200120` |
| 2.0.121 | `200121` |
| 2.0.122 | `200122` |
| `minSupportedVersionCode` (current) | **`20000` — unchanged** |

Do not raise `minSupportedVersionCode` in this cutover.

## Before running migration `2026-11-02.1`

Take a fresh encrypted backup first:

```bash
# on the VPS, as root
systemctl start smart-survey-backup.service
# or force the script if the hourly run is not due:
sudo -u postgres bash -c 'set -a; . /etc/smart-survey-backup.env; set +a; BACKUP_FORCE=1 bash /opt/smart-survey-x/scripts/backup-db.sh'
curl -sk -H "Authorization: Bearer <super-admin-token>" \
  https://162.35.96.65.sslip.io/api/backup/status
```

Confirm `status=ok`, a fresh `finished_at`, and the R2 object before deploying the API
migration.

## Rollback

- DNS: restore the previous `api` A record.
- Web: revert the branch / redeploy `main`.
- Caddy: old block was never removed; remove only the new site block.
- APK: old APKs were never changed; new APK 2.0.122 can be pulled from the release page.
- No database or CORS-origin changes are involved.

## Not done yet

- DNS record still points at Vercel; the Caddy block is **not loaded**.
- Web changes are committed only on the local `api-domain-cutover` branch and not pushed.
- Traffic accounting (`app_traffic` + `/api/app-traffic`) and the sync-time update
  prompt are prepared on the branch; the API migration has not run and nothing is deployed.
- APK 2.0.122 is not built or published.
- **No 426 gate. sslip stays live with no retirement date.**
- `minSupportedVersionCode` remains `20000`.

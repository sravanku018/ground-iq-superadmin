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

## Step 5 — shorter retirement of sslip (weeks, not 90 days)

`/api/app-version` cannot force **old** APKs by itself — they ignore
`minSupportedVersionCode`. Two-part approach:

1. **2.0.122 client**: treat `APP_VERSION_CODE < minSupportedVersionCode` as
   `mandatory` (dismiss button hidden). Prepared in `src/appUpdate.js` on the branch.
2. **Old-host gate** after a cutoff: Caddy or the API returns `426 Upgrade Required`
   for `162.35.96.65.sslip.io` on every path **except**:
   - `/api/app-version`
   - `/api/app.apk`
   - `/api/health`

   Old APKs can still check and download the update; normal API calls fail until they
   update. Old web clients are already on the new host by then.

Proposed timeline (after the freeze lifts):

| Day | Action |
|---|---|
| 0 | Publish 2.0.122; both API hosts live |
| 1–14 | Monitor old-host logs; normal update prompts |
| 14 | Set `minSupportedVersionCode = 200122`; enable old-host 426 gate (exempt update routes) |
| 14–28 | Stragglers update; old host only serves version/APK/health |
| 28 | Remove sslip from web CSP; remove the Caddy block and DNS record |

This gives ~4 weeks instead of 90 days while keeping an update path at every step.

## Rollback

- DNS: restore the previous `api` A record.
- Web: revert the branch / redeploy `main`.
- Caddy: old block was never removed; remove only the new site block.
- APK: old APKs were never changed; new APK 2.0.122 can be pulled from the release page.
- No database or CORS-origin changes are involved.

## Not done yet

- DNS record still points at Vercel; the Caddy block is **not loaded**.
- Web changes are committed only on the local `api-domain-cutover` branch and not pushed.
- APK 2.0.122 is not built or published.

# API — Ground IQ / Smart Survey X

Runs on the Oracle VPS as a systemd service against **PostgreSQL 18.6**
(cluster `18/main`, database `smart_survey_x`, localhost only).

- Service: `smart-survey-x` (port 8000, behind Caddy on 443)
- Home on the VPS: `/opt/smart-survey-x/` (mirror of this folder)
- DB client: `db/client.ts` + `legacy/handler.ts` `createSql()` — keep their
  postgres() options in sync. Neon (Deno Deploy) is **not used**; the neon.tech
  branch in the client is dormant.

## Deploy an API change

Edit files under `hono-api/` (routes, `legacy/handler.ts`), then:

```bash
# 1. type-check locally (236 pre-existing errors are known noise; no NEW ones)
cd /home/sravan/Downloads/neondbapp/hono-api && deno check main.ts

# 2. copy the changed files to the VPS
scp -i "/home/sravan/Downloads/vps oracle/id_ed25519" \
  db/client.ts root@162.35.96.65:/opt/smart-survey-x/db/
scp -i "/home/sravan/Downloads/vps oracle/id_ed25519" \
  legacy/handler.ts deno.json deno.lock root@162.35.96.65:/opt/smart-survey-x/

# 3. pre-fetch deps and restart
ssh -i "/home/sravan/Downloads/vps oracle/id_ed25519" root@162.35.96.65 \
  'cd /opt/smart-survey-x && deno cache main.ts && systemctl restart smart-survey-x'
```

4. Verify: `curl -s http://127.0.0.1:8000/` on the VPS and one DB-backed
   endpoint; `journalctl -u smart-survey-x -n 20`.

## Voice translation (Soniox)

Field voice notes and survey voice recordings are transcribed in batch with
Soniox, with a one-way translation to English. The key is **server-side only** —
never put it in the Vite/APK build. It lives in `/opt/smart-survey-x/.env` on
the VPS (and in `hono-api/.env` for local dev):

```
SONIOX_API_KEY = snx_proj_...
```

Without the key, `/api/conversations/config` reports `enabled: false`;
recordings still save on the phone and translate after the key is added.

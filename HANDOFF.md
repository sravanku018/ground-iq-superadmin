# Handoff — what happened (read this before editing)

Other CLI / next session: this is the state after 27 Aug 2026. Do **not** paste `main.ts` into Deno Playground. Do **not** point the app back at `jazzy-crocodile-7790`.

## Live API (GitHub → Deno, no paste)

| | |
|---|---|
| **URL the websites use** | `https://ground-iq-api.sravanku018.deno.net` |
| **GitHub repo Deno watches** | https://github.com/sravanku018/ground-iq-api (private, `main.ts` at **repo root**) |
| **Source in this repo** | `hono-api/` (copied to that GitHub repo on push) |
| **Old Playground (do not paste here)** | `jazzy-crocodile-7790` / `deno-deploy/main.ts` |

`src/api.js` `DENO_API_URL` is already the new URL. GitHub Pages CORS for `https://sravanku018.github.io` is on the live API (health 200, DB connected, OPTIONS login ACAO present).

Phone **APK still has the old URL** until a rebuild. Browser login is the new URL.

## How the human deploys (keep it in Python)

```bash
cd /home/sravan/Downloads/neondbapp
python3 bump_version.py
# if no Tk window: python3 bump_version.py --web
```

Purple **Push websites + API**:

1. `git push ground-iq HEAD:main` → Client Admin Pages  
2. `git push ground-iq-superadmin HEAD:main` → Super Admin Pages  
3. Copies `hono-api/` → `ground-iq-api` GitHub → Deno auto-deploys  

Do not ask them to `git` by hand or to paste into dash.deno.com unless Python push failed.

## Git remotes (this folder)

| Remote | Repo | What it is |
|---|---|---|
| `ground-iq` | sravanku018/ground-iq-web | Client Admin + this source tree |
| `ground-iq-superadmin` | sravanku018/ground-iq-superadmin | Super Admin Pages only |
| (separate clone) | sravanku018/ground-iq-api | API only — Deno console app |

Branch here: `ground-sync` → push as `HEAD:main` on those remotes. Nested `git init` inside this folder is wrong.

## What broke and what we changed

### CORS (login blocked in Firefox)

Portals are on **GitHub Pages**. Origin is `https://sravanku018.github.io`.  
Allow-list had only Vercel + localhost, so OPTIONS `/api/auth/login` returned **204 with no `Access-Control-Allow-Origin`**.

Fix (in `hono-api/legacy/handler.ts` and `deno-deploy/main.ts`): allow GitHub Pages, Vercel previews, localhost/Capacitor; merge `ALLOWED_ORIGINS` env instead of replacing; allow `cache-control` on preflight.

### Voice minute limits = Super Admin only

`survey_form.voice_time_limit` (2 / 5 / 10 / 15 min auto-stop) is **writable only by Super Admin**.  
Client Admin with `can_record_voice` may still set **Off vs Required**. API **ignores** `voice_time_limit` from Client Admin so old UIs cannot overwrite Super Admin. Duration chips hidden in Client Admin (`src/AdminSurveys.jsx`). Super Admin Companies create-project still has the chips.

See `deno-deploy/SCHEMA.md` (voice row + decisions log).

### Stop pasting the monolith

User could not keep pasting ~10k-line `deno-deploy/main.ts`. We added `hono-api/` (Hono entry `main.ts` + `legacy/handler.ts` copy of the API). Deno **new console** (`console.deno.com`) does **not** support monorepos, so a dedicated repo `ground-iq-api` was created with `hono-api` at the root.

Do **not** edit only `deno-deploy/main.ts` and expect production to change. Production is `hono-api/legacy/handler.ts` → push via Python → `ground-iq-api`.

Keep `deno-deploy/main.ts` in sync if you must, but it is backup/Playground only.

## Files that matter now

| Path | Role |
|---|---|
| `hono-api/main.ts` | Hono entry, routes `/api/auth` `/api/users` `/api/surveys`, rest → legacy |
| `hono-api/legacy/handler.ts` | Real API (CORS, login, surveys, voice_time_limit Super Admin only) |
| `src/api.js` | `DENO_API_URL = https://ground-iq-api.sravanku018.deno.net` |
| `bump_version.py` | Version + APK + push websites + push API |
| `deno-deploy/SCHEMA.md` | Access-control rules — update if you touch grants/companies/voice |
| `src/AdminSurveys.jsx` | Minute-limit chips: `isSuper` only |

## Do not

- Paste into Playground `jazzy-crocodile-7790` as the normal deploy path  
- Point `DENO_API_URL` back at `jazzy-crocodile-7790`  
- Put duration chips back on Client Admin  
- Add a live `company_name` check into `adminFormKeyScope` (see SCHEMA.md)  
- Overwrite Super Admin slot 1 password  
- Claim GitHub Pages UI is verified in a browser unless you actually clicked login  
- `git init` again in this folder  

## If login CORS fails again

Probe:

```bash
curl -sI -X OPTIONS 'https://ground-iq-api.sravanku018.deno.net/api/auth/login' \
  -H 'Origin: https://sravanku018.github.io' \
  -H 'Access-Control-Request-Method: POST'
```

Must show `access-control-allow-origin: https://sravanku018.github.io`.

## If the human cannot see `ground-iq-api` in Deno’s GitHub picker

GitHub → Settings → Applications → **Deno / Deno Deploy** → Configure → add repo `ground-iq-api` (private). Refresh console.deno.com.

## Still unpushed / unfinished in the working tree (as of this handoff)

Possible leftover local edits (not all in the last commit): `bump_version.py` Python push-API work, `FieldCollect.jsx`, `SurveyorApp.jsx`, `android/…/AndroidManifest.xml`, `package.json` version, `deno-deploy/survey.txt`. Check `git status` before assuming clean.

APK in-app update / background survey notify / version bump to 2.0.8+ need a **release APK rebuild** after Python bump+push if the phone should hit the new API URL.

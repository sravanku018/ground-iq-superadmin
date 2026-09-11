# Deno Deploy for Election Survey API

## How it works with your app

```
┌─────────────────────┐         HTTPS          ┌──────────────────────┐
│  Android APK / Web  │  ───────────────────►  │  Deno Deploy edge    │
│  Login · Survey ·   │   your-app.deno.dev    │  main.ts (this API)  │
│  Dash               │  ◄───────────────────  │                      │
└─────────────────────┘                        └──────────┬───────────┘
                                                          │ Neon driver
                                                          ▼
                                               ┌──────────────────────┐
                                               │  Neon PostgreSQL     │
                                               │  (same DATABASE_URL) │
                                               └──────────────────────┘
```

| Piece | Today (local) | With Deno Deploy |
|--------|----------------|------------------|
| API | `node server` on your PC `:3001` | `https://….deno.dev` (always online) |
| Database | Neon | **Same Neon** |
| React / APK UI | Vite / Capacitor | Unchanged — only **API URL** changes |
| Login roles | admin only | Admin only (field/user disabled) |

**Playground does not replace the mobile UI.**  
It hosts the **backend API**. The app still runs on the phone; it just calls Deno instead of your laptop.

---

## Option A — Deno Deploy Playground (fastest)

1. Go to [https://dash.deno.com](https://dash.deno.com) → sign in  
2. **New Playground** (or **New Project** → Playground)  
3. Paste `main.ts` into the editor  
4. Open **Settings / Environment variables** (or Playground secrets):

   | Name | Value |
   |------|--------|
   | `DATABASE_URL` | Your Neon URL (`…?sslmode=require`) |

5. **Save / Deploy**  
6. Copy the public URL, e.g.  
   `https://election-survey-abc123.deno.dev`

7. In the **app**:  
   **API server settings** → paste that URL (no trailing `/`) → Save  

8. Login (admin only):
   - Admin: `admin` / `admin123`

> **Note:** First deploy may rewrite demo password hashes to Deno-compatible PBKDF2 so login works on the edge. Legacy field/user accounts are disabled.

---

## Option B — deployctl from this folder

```bash
cd deno-deploy
# install deployctl once: deno install -A jsr:@deno/deployctl
export DATABASE_URL='postgresql://…neon…/neondb?sslmode=require'
deployctl deploy --project=election-survey --env=DATABASE_URL main.ts
```

---

## What the playground script includes

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | DB check |
| `POST /api/auth/login` | Admin login only |
| `POST /api/auth/register` | Disabled |
| `GET /api/auth/me` | Session |
| `GET/POST /api/submissions` | List / create |
| `GET /api/geo` (+ mandals) | Dropdown data |
| `GET /api/stats` | Home counts |
| `GET /api/analytics` | Basic party chart (admin/user) |

**Not fully ported yet** (still on Node if you need them): full stacked charts, all admin user-management CRUD, Excel upload.  
You can grow `main.ts` until it matches `server/index.js`.

---

## Rebuild APK to bake Deno URL

```bash
# .env.production
VITE_API_BASE_URL=https://YOUR-PROJECT.deno.dev

npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

Or leave default and set the Deno URL inside the app under **API server settings**.

---

## Pros / cons

**Pros**
- Phone works **without your PC** on the same Wi‑Fi  
- Free tier / global edge  
- Same Neon data as local Node  

**Cons**
- Playground is best for a **single-file API**, not the whole React UI  
- Cold starts possible on free tier  
- Password hashing on Deno uses PBKDF2 (demo users auto-upgraded)  
- Deno Deploy Classic is evolving — check current Deno docs for product renames  

---

## Mental model

| You want | Tool |
|----------|------|
| API always online for the APK | **Deno Deploy** (this folder) |
| Full local dev | `npm run dev` (Node + Vite) |
| UI on phone | Capacitor APK pointing API at Deno URL |
| Database | Neon (already) |

# Cloudflare R2 for photo & audio (recommended free storage)

Neon only stores **URL links**. Files live on **Cloudflare R2** (free tier: **10 GB** storage).

## This project’s bucket (already created)

| | |
|--|--|
| **S3 API endpoint** | `https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com` |
| **Bucket** | `election-survey-media` |
| **Full path** | `https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com/election-survey-media` |
| **Account ID** | `6f54ac7c46cba07b9dac5e1548348f4f` |

These are the **defaults in `main.ts`**. You still must set **API keys** + **public URL**.

> The `*.r2.cloudflarestorage.com` host is **private API only** (needs SigV4).  
> Browsers need a **public** base: `https://pub-….r2.dev` or a custom domain.

## 1. Public access (required to open media)

1. Cloudflare Dashboard → **R2** → bucket `election-survey-media`
2. **Settings** → **R2.dev subdomain** → **Allow Access**
3. Copy public base, e.g. `https://pub-xxxxxxxx.r2.dev` (no trailing slash)

## 2. API token (S3 credentials)

1. R2 → **Manage R2 API Tokens** → **Create API token**
2. Permissions: **Object Read & Write** on `election-survey-media`
3. Copy:
   - **Access Key ID**
   - **Secret Access Key**

## 3. Deno Deploy / local env

**Deno Deploy** → Project → Settings → Environment Variables (or Playground secrets):

| Variable | Value |
|----------|--------|
| `R2_ACCOUNT_ID` | `6f54ac7c46cba07b9dac5e1548348f4f` *(optional — defaulted in code)* |
| `R2_ENDPOINT` | `https://6f54ac7c46cba07b9dac5e1548348f4f.r2.cloudflarestorage.com` *(optional)* |
| `R2_BUCKET` | `election-survey-media` *(optional — defaulted)* |
| `R2_ACCESS_KEY_ID` | from API token **required** |
| `R2_SECRET_ACCESS_KEY` | from API token **required** |
| `R2_PUBLIC_URL` | `https://pub-xxxxxxxx.r2.dev` **required** |

Aliases: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_*`.

Local:

```bash
cp .env.example .env
# fill R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL
deno run -A --env main.ts
```

Keep existing:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon Postgres |

## 4. Redeploy API

Redeploy `main.ts` after setting env vars.

## 5. Verify

```bash
# After a field sync with photo+audio:
curl -s "https://YOUR.deno.net/api/submissions/ID/media" \
  -H "Authorization: Bearer ADMIN_TOKEN"
# Expect: "storage": "cloudflare_r2", "url": "https://pub-.../election-survey/photo/..."
```

Client Admin → **Review** → expand row → open photo / play audio from the R2 link.

## Path layout in the bucket

```
election-survey/photo/2026-08-02/<uuid>.jpg
election-survey/audio/2026-08-02/<uuid>.webm
```

## Fallback order (if R2 not configured or fails)

1. Cloudflare R2  
2. `MEDIA_UPLOAD_URL` (optional Worker)  
3. Catbox / 0x0 / Litterbox (public free hosts)

## CORS (if browser loads R2 URLs)

Public r2.dev usually works for `<img>` and `<audio>`. Custom domain: allow GET from your admin origin if needed.

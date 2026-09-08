# Redeploy Deno API

After Client Admin **edit/delete** survey data was added, redeploy so these work on production:

- `GET /api/submissions/:id`
- `PATCH /api/submissions/:id` — edit answers, geo, surveyor, status
- `DELETE /api/submissions/:id`

## Free photo / audio (NO credit card)

**Default: Neon** (your existing free DB) — no card, no Cloudflare signup.

- Photo/audio stored size-limited in `survey_media`
- Served at `GET /api/media/:id/file` (login required)
- Client Admin Review loads them with the admin token

Optional later (only if you already have keys — not required):

| Name | Purpose |
|------|---------|
| `R2_*` | Cloudflare R2 if you already set it up |
| `MEDIA_UPLOAD_URL` | Custom worker |

See `CLOUDFLARE_R2.md` only if you choose R2 later.

## Latest — pipeline: users → Q/A → confirm → analytics

Redeploy `main.ts` for:
- `POST /api/users/generate` — bulk surveyors
- `GET/POST /api/users` — list/create
- Submissions `status`: pending | confirmed | rejected
- `PATCH /api/submissions/:id/status` — confirm done
- `POST /api/submissions/confirm-pending` — bulk confirm
- `GET /api/analytics?status=confirmed` (default report)

## Geo data fixes (Hanamkonda + missing ACs)

- `assembly_constituencies` now maps Warangal East/West + Wardhannapet to **Hanumakonda**
  district (2022 reorg); records uploaded as "Hanamkonda" resolve there.
- Added missing **Secunderabad** AC, removed bogus "Malkajgiri Urban".
- District names normalized to official 33 (Jagitial, Komarambheem Asifabad, ...).

**After redeploy, re-seed the geo tables once:**

```bash
psql "$DATABASE_URL" -f neondbapp/scripts/seed-geo.sql
```

(Existing survey rows are re-resolved on the fly — no data migration needed.)

## Earlier — district count wrong (33 vs ~7)

Home KPI used **master** `districts` table count (33 Telangana districts).
It should show **survey coverage** — districts that appear in survey data (~7).

`/api/stats` now returns:
- `districts` / `assembly_constituencies` = survey coverage
- `districts_master` / `assembly_constituencies_master` = uploaded geo tables
- `mandals` = master mandals table

## Redeploy (Playground)

1. Open https://dash.deno.com  
2. Open project **jazzy-crocodile-7790**  
3. Replace **all** code with contents of:
   `neondbapp/deno-deploy/main.ts`
4. Confirm env **DATABASE_URL** = Neon connection string  
5. **Save / Deploy**

## Verify

```bash
TOKEN=$(curl -s -X POST https://jazzy-crocodile-7790.sravanku018.deno.net/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123","expected_role":"admin"}' | jq -r .token)

# Districts KPI should be ~7 (survey), not 33 (master)
curl -s "https://jazzy-crocodile-7790.sravanku018.deno.net/api/stats" \
  -H "Authorization: Bearer $TOKEN" | jq '{districts, districts_master, assembly_constituencies, submissions}'

# Filters still work
curl -s "https://jazzy-crocodile-7790.sravanku018.deno.net/api/analytics?district=Nizamabad" \
  -H "Authorization: Bearer $TOKEN" | jq '{filtered, totalAll, isFiltered, districts: .filterOptions.districts}'
```

Expect: `districts` ≈ 7, `districts_master` = 33, filters `isFiltered: true`.

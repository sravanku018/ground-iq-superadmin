# Ground IQ Web

Client Admin web portal + surveyor field app — static Vite/React SPA.
API is hosted separately on Deno Deploy (Neon DB):

- Portal (admin login): `https://sravanku018.github.io/ground-iq-web/admin`
- Field app (surveyor login): `https://sravanku018.github.io/ground-iq-web/`
- API base: `https://jazzy-crocodile-7790.sravanku018.deno.net` (see `src/api.js`, `.env.production`)

## Local dev

```bash
npm install
npm run client   # → http://localhost:5173  (portal at /admin)
```

## Deploy

Push to `main` → GitHub Actions builds with `VITE_BASE=/ground-iq-web/` and publishes to Pages.

## Notes

- `dist/404.html` (copy of index.html) gives the SPA fallback so `/admin` and
  deep links work on GitHub Pages.
- Android APK lives in the original `neondbapp` repo — not here.

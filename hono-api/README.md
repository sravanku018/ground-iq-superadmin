# API — no more pasting

GitHub push deploys this folder to the same URL:

`https://jazzy-crocodile-7790.sravanku018.deno.net`

## After the one-time token (see below)

```bash
cd /home/sravan/Downloads/neondbapp
git add -A
git commit -m "api change"
git push ground-iq ground-sync:main
```

That is the whole deploy.

## One-time setup (once only)

1. Open https://dash.deno.com/account#access-tokens  
2. **New Access Token** → copy it  
3. Open https://github.com/sravanku018/ground-iq-web/settings/secrets/actions  
4. **New repository secret**  
   - Name: `DENO_DEPLOY_TOKEN`  
   - Value: paste the token  
5. Open https://github.com/sravanku018/ground-iq-web/actions → **Deploy API** → **Run workflow**

After that, every push updates the live API. Do not paste into the Deno editor.

Edit files under `hono-api/` (routes, `legacy/handler.ts`). `deno-deploy/main.ts` is the old paste file — leave it.

# Ground IQ — Super Admin Console

Separate GitHub Pages site for the **Super Admin** role (max 3 accounts).

- URL: `https://sravanku018.github.io/ground-iq-superadmin/`
- Login is **server-enforced**: only accounts with role `super_admin` can sign in here
  (`expected_role=super_admin` → 403 for everyone else). Client Admins use the main
  portal at `https://sravanku018.github.io/ground-iq-web/`.
- The build is a variant of the main `ground-iq-web` repo (`VITE_SUPER_ADMIN=1`),
  checked out fresh on every run — deploy it by re-running this workflow
  (Actions → Deploy Super Admin console → Run workflow), it always builds the
  latest `main`.

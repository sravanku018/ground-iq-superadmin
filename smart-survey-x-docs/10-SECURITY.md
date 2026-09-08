# Smart Survey X — Security Specification

**Version:** 1.0 (Locked)
**Depends on:** all prior documents
**Feeds into:** `11-TESTING-STRATEGY.md`, `12-DEPLOYMENT.md`

---

## 1. Authentication

- **JWT-based**, short-lived access token (recommended: 15–30 min) + longer-lived refresh token (Admin Portal: hours-to-days; Surveyor App: up to 14 days per FR-AUTH-02, to survive offline periods).
- Passwords: bcrypt or argon2 hashed, never stored/logged in plaintext, never returned in any API response.
- Rate limiting on login: 5 failed attempts / 15 minutes per account, then temporary lockout (FR-AUTH-05).
- Surveyor App caches the session/token securely on-device (platform secure storage — Keychain/Keystore, not plain SharedPreferences/UserDefaults) so offline relaunch doesn't require re-entering credentials, per BR-030.

## 2. Authorization

- **Role check on every endpoint**, enforced server-side (API Spec §12 rule 2) — the six roles (`super_admin`, `client_admin_main`, `client_admin_sub`, `dashboard_viewer`, `surveyor`, and implicitly `survey_supervisor` reserved for Phase 2) are the complete permission model; no ad-hoc permission flags outside this set in MVP.
- **Tenant isolation** (System Design §3, Business Rules §6): two-layer enforcement — application-layer `tenant_id` injection from JWT claims, plus PostgreSQL Row-Level Security as backstop (Database Design §3). Both layers are mandatory; neither alone is considered sufficient given the shared-DB multi-tenancy model.
- **Actor-level audit** (BR-061): authorization failures (403s) are themselves worth logging at elevated severity if repeated from the same actor — a pattern of an admin probing other tenants' IDs is a security signal, not just a UX error.

## 3. Data Protection

- **Government ID / sensitive identity documents** (`surveyor_profiles.govt_id_reference`, FR-USR-05): stored as an R2 reference to an encrypted-at-rest object, never as a raw document in a plaintext database column. Access to view this reference is restricted to Client Admin (Main/Sub) of the surveyor's own tenant and Super Admin — this is a stricter access rule than general tenant data, and should be a distinct permission check, not folded into generic "can view user profile."
- **Evidence media** (photo/audio, Database Design §2.6): R2 buckets/prefixes are private by default; all access is via short-lived pre-signed URLs generated per-request, never a permanently public bucket URL.
- **PII minimization in exports**: Data Export (FR-EXP-03) explicitly excludes credentials and other tenants' data even within the exporting tenant's own scope; it should also exclude other surveyors' raw government-ID references — a tenant data export is about survey records, not a bulk HR data dump, unless a future requirement explicitly asks for that.
- **Encryption in transit**: HTTPS/TLS everywhere, no exceptions, including the sync endpoints hit by the Surveyor App over potentially untrusted public networks.
- **Encryption at rest**: PostgreSQL disk encryption (managed-provider default) and R2 server-side encryption (default on R2).

## 4. Evidence Integrity (tamper-evidence, per BR-032)

- SHA-256 checksum computed and stored at lock time for every photo and audio file (Database Design §2.6 `checksum_sha256` columns).
- No API endpoint, for any role including Client Admin, permits replacing a locked evidence file's R2 object or its checksum record (FR-EVD-05) — verified by an explicit negative test case (see `11-TESTING-STRATEGY.md`).
- GPS/timestamp values on `records` are written once at sync time from device-reported values at capture; there is no PATCH endpoint for `records.gps_point`, `captured_at`, or `submitted_at` in the API Spec — their absence from the API surface **is** the enforcement mechanism, not a separate permission check.

## 5. Seat Limits & Account Creation Integrity

- Race-condition-safe seat limit checks (Database Design §4 note 5) — treated as a security-adjacent concern because a race condition here is a business-logic bypass (a tenant exceeding what they're entitled to), not merely a UX bug.
- Only Super Admin can create a tenant + Main admin (BR-002); this bootstrap path has no self-service alternative, closing off tenant-creation as an attack/abuse surface via the public API.

## 6. Super Admin Account Bootstrap

- The first Super Admin account(s) (up to 3, BR-007) are provisioned via a deployment-time seed script (`12-DEPLOYMENT.md`), not through any authenticated API endpoint — there is no `POST /users/super-admins` in the API Spec by design, since such an endpoint would need to be callable by *someone* already a Super Admin, and the very first one can't satisfy that. Subsequent Super Admin accounts (2nd, 3rd) are created by an existing Super Admin through an internal-only endpoint (documented in `12-DEPLOYMENT.md` as an operational procedure, not exposed in the public API surface used by the web portal UI).

## 7. Review & Approval Integrity

- Review decisions (`record_reviews`) are 1:1 with a record and immutable once written (Database Design §2.7) — an admin cannot silently change an approval to a rejection after the fact; correcting a wrong decision is an out-of-band ops action (Business Rules §1.3 rule 6), not a supported product flow, which also means it can't be abused as a routine "undo."
- Reject reason is mandatory (BR-043) partly for UX quality and partly as an accountability mechanism — a rejection with no stated reason is not auditable.

## 8. Dependency & Platform Hygiene (operational, not a specific feature)

- Backend dependencies (FastAPI, Celery, etc.) and Flutter/Next.js dependencies should be kept on maintained versions; this document does not pin specific versions (that's `12-DEPLOYMENT.md`/CI config) but flags that dependency currency is a standing security requirement, not a one-time setup step.
- Secrets (DB credentials, R2 keys, JWT signing secret) are never committed to the repository — environment-variable/secret-manager based configuration only, detailed in `12-DEPLOYMENT.md`.

---
*Next document: `11-TESTING-STRATEGY.md`*

# Privacy Policy — Smart Survey X (Election Survey)

**Effective date:** 2026-10-02 · **App version:** 2.0.66 · **Package:** `com.groundiq.electionsurvey`

Smart Survey X ("Ground IQ", "we") provides an election field-survey app for surveyors
and a web portal for client administrators. This policy explains what we collect and why.

## 1. Data we collect

**From survey respondents (only with your consent, collected by a surveyor or web form):**
- Answers you give to survey questions (e.g. demographics, opinions, voting preferences).
- Location (GPS coordinates + district/mandal) captured once per survey record.
- A field photograph and, where stated, a voice recording — as evidence that the survey happened.
- Date/time and technical metadata of the submission.

**From surveyor (staff) accounts:** username, display name, phone number (+91),
profile photo, Aadhaar front/back images for identity verification, login and activity records.

**From admin accounts:** username, contact details, login records and action audit logs.

**Automatically:** login session tokens, app version, device sync-queue status,
and server logs (IP address used only for login abuse protection).

## 2. Device permissions and why we need them

- **Location** — to record where each survey was conducted (once per record, never background tracking).
- **Camera** — to capture the required field photo for each survey record.
- **Microphone** — to record voice evidence where the survey requires it.
- **Internet** — to log in and sync survey data to our servers.
- **Install packages** — to install app updates you approve.

Location, camera and microphone are requested only when you create a survey record.
Refusing location or camera means that record cannot be submitted.

## 3. How we use data

- To conduct, verify and analyse election surveys for our contracted clients.
- To manage surveyor and admin accounts, verify staff identity, and prevent fraud/abuse.
- To operate, secure and improve the app (sync, support, audit logging).
- We do **not** sell personal data, show ads, or share data with data brokers.

## 4. Who sees data

- Your survey answers, photo, voice and location are visible to the client administrator
  who commissioned the survey and their authorised reviewers — for verification and analysis.
- Surveyor identity documents (Aadhaar) are visible only to designated verifier admins.
- Our infrastructure providers (Neon database hosting, Cloudflare file storage, Deno/Oracle
  API hosting) process data solely to provide hosting; they do not use it for their own purposes.
- Anonymous web-survey links accept one submission per capped token and expose no other data.

## 5. Storage, security and retention

- Data is transmitted over HTTPS and stored encrypted at rest (Neon PostgreSQL +
  private Cloudflare R2 media bucket; media is served only through authenticated API URLs).
- Passwords are stored as salted PBKDF2 hashes, never plaintext; Super Admin logins
  additionally require an authenticator-app code (TOTP); logins are rate-limited.
- Survey drafts are stored on the surveyor device (offline queue) until synced.
- Records are kept while the client account is active for election-analysis purposes.
  You may request access, correction, export or deletion at any time (section 6).
- Sessions expire after 30 days and are revoked on logout, password change, or account
  deactivation/deletion.

## 6. Your rights and choices

- Participation is voluntary: you may decline a survey, skip optional questions,
  or ask for your record to be corrected or deleted.
- To exercise access / correction / deletion / export / consent-withdrawal, contact
  the organisation that surveyed you, or reach us at [ADD — privacy contact email/phone].
  We respond within 30 days.
- Children: we survey adults (18+) only.

## 7. Changes to this policy

We will update this page before any release that collects new data, requests a new
permission, or changes retention/sharing. Continued use after the update constitutes acceptance.

## 8. Contact

- Privacy requests: [ADD — name + email/phone]
- Security issues: [ADD — security contact]
- Grievance (India DPDP Act 2023): [ADD — grievance officer name + email, response within statutory timelines]

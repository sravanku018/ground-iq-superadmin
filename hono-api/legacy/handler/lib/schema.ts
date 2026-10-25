import {
  uniqueUserKeyId,
} from "./audit.ts";
import {
  sql,
} from "./db.ts";
import {
  backfillFacts,
} from "./facts.ts";
import {
  seedMissingSuperAdminSlots,
} from "./totp.ts";

export async function ensureSchema(): Promise<void> {
  if (!sql) return;

  const steps: Array<() => Promise<unknown>> = [
    // app_users — columns getUser() reads
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS company_name TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS key_id TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS phone TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_manage_questions BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_edit_surveys BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_review_data BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_verify_surveyors BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_assign_surveyors BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_crud_questionnaire BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_validate_proof BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_web_survey BOOLEAN NOT NULL DEFAULT TRUE`,
    () => sql`UPDATE app_users SET can_web_survey = TRUE WHERE role = 'admin' AND (can_web_survey IS NOT TRUE)`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_record_voice BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_translate_telugu BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_questions_per_survey INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveys INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_surveyors INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_records INTEGER NOT NULL DEFAULT 0`,
    // Question categories a Client Admin may create. 0 = unlimited, like the other max_* grants.
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_categories INTEGER NOT NULL DEFAULT 5`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_secret TEXT`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS created_by INT`,
    // Role check (moved out of seedMissingSuperAdminSlots)
    () => sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check`,
    () => sql`ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('super_admin','admin','field','user','surveyor'))`,
    // Enables ON CONFLICT (survey_id, user_id) in upsertSurveyAssignment
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS survey_assignments_survey_user_uidx ON survey_assignments (survey_id, user_id)`,
    // Per-assigned-survey target (Home stacked bar). Never store COUNT(assignments) here.
    () => sql`ALTER TABLE survey_assignments ADD COLUMN IF NOT EXISTS target_quota INTEGER NOT NULL DEFAULT 0`,
    () => sql`
      UPDATE survey_assignments sa
      SET target_quota = COALESCE((
        SELECT COALESCE(u.target_quota, 0) FROM app_users u WHERE u.id = sa.user_id
      ), 0)
      WHERE COALESCE(sa.target_quota, 0) = 0
        AND (SELECT COUNT(*) FROM survey_assignments x WHERE x.user_id = sa.user_id) = 1
    `.catch(() => null),
    // Companies table
    () => sql`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_app_users_company ON app_users(company_id)`,
    // Question categories: each Client Admin / company owns its own vocabulary.
    () => sql`
      CREATE TABLE IF NOT EXISTS question_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        company_id INT,
        created_by INT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    // Unnamed tenant bucket keeps the uniqueness rule per company.
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_question_categories_tenant_name ON question_categories (COALESCE(company_id, -1), LOWER(name))`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS created_by INT`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS display_lang TEXT NOT NULL DEFAULT 'en'`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS voice_required BOOLEAN NOT NULL DEFAULT FALSE`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS voice_time_limit INT NOT NULL DEFAULT 0`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS company_name TEXT`,
    () => sql`ALTER TABLE survey_form ADD COLUMN IF NOT EXISTS company_id INT`,
    () => sql`CREATE INDEX IF NOT EXISTS idx_survey_form_company ON survey_form(company_id)`,
    // Public web-survey links: Copy mints a token; expires after max_uses submits.
    () => sql`
      CREATE TABLE IF NOT EXISTS web_survey_links (
        token TEXT PRIMARY KEY,
        form_key TEXT NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        submission_id INTEGER,
        max_uses INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_web_survey_links_form ON web_survey_links (form_key)`,
    () => sql`ALTER TABLE web_survey_links ADD COLUMN IF NOT EXISTS max_uses INTEGER NOT NULL DEFAULT 1`,
    () => sql`ALTER TABLE web_survey_links ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0`,
    // Offline field conversations: audio + English batch transcript per surveyor.
    () => sql`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        local_id TEXT,
        form_key TEXT,
        title TEXT,
        recorded_at TIMESTAMPTZ,
        duration_ms INTEGER,
        audio_mime TEXT,
        audio_data TEXT,
        audio_bytes INTEGER,
        transcript TEXT,
        transcript_original TEXT,
        transcript_status TEXT NOT NULL DEFAULT 'stored',
        transcript_error TEXT,
        soniox_file_id TEXT,
        soniox_transcription_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_conversations_user_time ON conversations (user_id, recorded_at DESC)`,
    () => sql`CREATE UNIQUE INDEX IF NOT EXISTS conversations_user_local_uidx ON conversations (user_id, local_id) WHERE local_id IS NOT NULL`,
    // Super-Admin-managed server settings (e.g. the Soniox key). Values are
    // never returned to clients in full.
    () => sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    // Fingerprint / passkey login (WebAuthn).
    () => sql`
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter BIGINT NOT NULL DEFAULT 0,
        transports TEXT,
        device_type TEXT,
        backed_up BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON webauthn_credentials(user_id)`,
    () => sql`
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        kind TEXT NOT NULL,
        challenge TEXT NOT NULL,
        origin TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_exp ON webauthn_challenges(expires_at)`,
    // Native Android fingerprint unlock: long-lived device tokens (hashed).
    () => sql`
      CREATE TABLE IF NOT EXISTS app_device_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      )
    `,
    () => sql`CREATE INDEX IF NOT EXISTS idx_app_device_tokens_user ON app_device_tokens(user_id)`,
    () => sql`
      ALTER TABLE survey_form
      ADD CONSTRAINT survey_form_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    `,
    // Optional self-healing respondent phone drop
    () => sql`ALTER TABLE survey_respondents DROP COLUMN IF EXISTS phone`,
    // Migrate legacy answer keys to current active question slugs
    () => sql`
      UPDATE submissions
      SET payload = jsonb_set(
        payload,
        '{answers}',
        (payload->'answers' - 'id' - 'w') || jsonb_build_object('which_you_prefer_to_watch', COALESCE(payload->'answers'->'which_you_prefer_to_watch', payload->'answers'->'id', payload->'answers'->'w'))
      )
      WHERE (payload->'answers' ? 'id' OR payload->'answers' ? 'w')
        AND NOT (payload->'answers' ? 'which_you_prefer_to_watch')
    `,
    () => sql`
      UPDATE submissions
      SET payload = jsonb_set(
        payload,
        '{answers}',
        (payload->'answers' - '2_whats_on' - 'q_mtpkyf2o' - 'whats_on' - '2_whats_on_gen') || jsonb_build_object('are_you_eligible_for_any_present_state_govt_schemes', COALESCE(payload->'answers'->'are_you_eligible_for_any_present_state_govt_schemes', payload->'answers'->'2_whats_on', payload->'answers'->'q_mtpkyf2o', payload->'answers'->'whats_on', payload->'answers'->'2_whats_on_gen'))
      )
      WHERE (payload->'answers' ? '2_whats_on' OR payload->'answers' ? 'q_mtpkyf2o' OR payload->'answers' ? 'whats_on' OR payload->'answers' ? '2_whats_on_gen')
        AND NOT (payload->'answers' ? 'are_you_eligible_for_any_present_state_govt_schemes')
    `,

  ];

  for (const step of steps) {
    await step().catch((e: unknown) => {
      const msg = String((e as Error)?.message || e || "");
      if (msg && !/already exists|duplicate/i.test(msg)) {
        console.error("schema step:", msg.slice(0, 200));
      }
    });
  }

  // Backfill key_id for existing users
  const noKey = await sql`
    SELECT id FROM app_users WHERE key_id IS NULL OR key_id = ''
  `.catch(() => []);
  for (const r of noKey as { id: number }[]) {
    await sql`UPDATE app_users SET key_id = ${await uniqueUserKeyId()} WHERE id = ${r.id}`
      .catch(() => null);
  }

  // Fill empty Super Admin seats as superadmin2 / superadmin3
  await seedMissingSuperAdminSlots(sql).catch((e) => {
    console.log("super admin slot seed skipped:", (e as Error).message);
  });
}

export async function ensureCompanyExists(
  sqlClient: typeof sql,
  rawName: string | null | undefined,
  createdBy: number | null
): Promise<{ id: number; name: string } | null> {
  if (!rawName || !sqlClient) return null;
  const name = String(rawName).trim().slice(0, 160);
  if (!name) return null;

  try {
    const existing = await sqlClient`
      SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
    `.catch(() => []);
    if (existing.length) {
      const comp = { id: Number((existing[0] as { id: unknown }).id), name: String((existing[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }

    const inserted = await sqlClient`
      INSERT INTO companies (name, created_by) VALUES (${name}, ${createdBy})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `.catch(() => []);
    if (inserted.length) {
      const comp = { id: Number((inserted[0] as { id: unknown }).id), name: String((inserted[0] as { name: unknown }).name) };
      await sqlClient`
        UPDATE app_users
        SET company_id = ${comp.id}, company_name = ${comp.name}
        WHERE LOWER(company_name) = LOWER(${comp.name}) AND (company_id IS NULL OR company_id <> ${comp.id})
      `.catch(() => null);
      return comp;
    }
  } catch {
    /* ignore fallback to re-select below */
  }

  const re = await sqlClient`
    SELECT id, name FROM companies WHERE LOWER(name) = LOWER(${name}) LIMIT 1
  `.catch(() => []);
  if (re.length) {
    return { id: Number((re[0] as { id: unknown }).id), name: String((re[0] as { name: unknown }).name) };
  }
  return null;
}

// Bump this when ensureSchema() steps change. The version is stored in
// app_settings; if it matches, the ~58 CREATE/ALTER round-trips are skipped.
const SCHEMA_VERSION = "2026-10-24.1";

export let schemaReady: Promise<void> | null = null;

async function schemaIsCurrent(): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT value FROM app_settings WHERE key = 'schema_version' LIMIT 1
    `;
    return rows.length > 0 && String(rows[0]?.value || "") === SCHEMA_VERSION;
  } catch {
    return false; // app_settings doesn't exist yet → run full schema
  }
}

async function markSchemaVersion(): Promise<void> {
  try {
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('schema_version', ${SCHEMA_VERSION}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${SCHEMA_VERSION}, updated_at = NOW()
    `;
  } catch {
    // Non-fatal: next cold start will re-run the schema pass
  }
}

export function ready() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Fast path: one SELECT instead of ~58 ALTERs on warm isolates
      if (await schemaIsCurrent()) return;
      await ensureSchema();
      await markSchemaVersion();
    })()
      .catch((e) => {
        console.error(e);
        schemaReady = null;
      })
      .then(() => {
        // Legacy fact catch-up runs AFTER the request path is served, so even a
        // large backfill can never stall boot or the deploy health check.
        if (sql) {
          void backfillFacts(sql).catch((e) => console.warn("fact backfill", e));
        }
      });
  }
  return schemaReady;
}


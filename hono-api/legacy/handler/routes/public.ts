import type { Ctx } from "./ctx.ts";
import {
  APP_RELEASE,
  GITHUB_REPO,
  servedApkRelease,
} from "../lib/apk.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  newToken,
  verifyPassword,
} from "../lib/crypto.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
  readBody,
} from "../lib/http.ts";
import {
  r2Config,
} from "../lib/r2-media.ts";
import {
  checkRateLimit,
} from "../lib/rate-limit.ts";
import {
  newTotpSecret,
  totpSetupPayload,
  verifyTotp,
} from "../lib/totp.ts";
import {
  sqlBool,
} from "../lib/users.ts";

export async function handlePublic(c: Ctx): Promise<Response | null> {
  const { req, url, path, method } = c;
  // Health
  if (path === "/" || path === "/api/health") {
    const r2 = r2Config();
    const r2Status = {
      keys_configured: Boolean(r2.ak && r2.sk),
      public_url_configured: Boolean(r2.publicBase),
      ready: Boolean(r2.ak && r2.sk && r2.publicBase && r2.buck),
    };
    if (path === "/") {
      return json({
        message: "Smart Survey X API on Deno Deploy",
        platform: "deno",
        auth: true,
        r2: r2Status,
      });
    }
    return json({
      ok: true,
      database: "connected",
      auth: true,
      platform: "deno",
      r2: r2Status,
    });
  }

  // App Version & In-App OTA Update Metadata (Telegram-style auto-update)
  if (path === "/api/app-version" && method === "GET") {
    // Report the release a client can actually download. Never a number ahead
    // of the published APK, or phones chase an update that cannot exist.
    const release = await servedApkRelease();
    return json(
      {
        appName: "Smart Survey X",
        version: release.version,
        versionCode: release.versionCode,
        minSupportedVersionCode: APP_RELEASE.minSupportedVersionCode,
        apkUrl: release.mirrorUrl ||
          `https://${req.headers.get("x-forwarded-host") || url.hostname}/api/app.apk`,
        apkDebugUrl: `https://github.com/${GITHUB_REPO}/releases/latest/download/ElectionSurvey-debug.apk`,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
        changelog: "In-app APK install, voice only when Super Admin/Client Admin requires it, IST timestamps.",
        apkSha256: release.sha256,
        apkSize: release.size,
        publishedAt: release.publishedAt || new Date().toISOString(),
      },
      200,
      { "cache-control": "no-store, no-cache, must-revalidate" },
    );
  }

  // Login — admin portal OR surveyor field app (accounts created by Client Admin only)
  if (path === "/api/auth/login" && method === "POST") {
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
    if (!checkRateLimit(ip)) {
      return json({ error: "Too many login attempts. Try again later." }, 429);
    }
    const body = await readBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const expectedRole = String(body.expected_role || "").trim().toLowerCase();
    if (!username || !password) {
      return json({ error: "Username and password required" }, 400);
    }
    const rows = await sql`
        SELECT id, username, display_name, role, active, created_at, password_hash,
               company_id, company_name, key_id, phone,
               COALESCE(verified, FALSE) AS verified,
               COALESCE(can_manage_questions, FALSE) AS can_manage_questions,
               COALESCE(can_edit_surveys, FALSE) AS can_edit_surveys,
               COALESCE(can_review_data, FALSE) AS can_review_data,
               COALESCE(can_verify_surveyors, FALSE) AS can_verify_surveyors,
               COALESCE(can_assign_surveyors, FALSE) AS can_assign_surveyors,
               COALESCE(can_crud_questionnaire, FALSE) AS can_crud_questionnaire,
               COALESCE(can_validate_proof, FALSE) AS can_validate_proof,
               COALESCE(can_web_survey, FALSE) AS can_web_survey,
               COALESCE(can_record_voice, FALSE) AS can_record_voice,
               COALESCE(can_translate_telugu, FALSE) AS can_translate_telugu,
               COALESCE(totp_enabled, FALSE) AS totp_enabled,
               totp_secret,
               COALESCE(max_questions_per_survey, 0) AS max_questions_per_survey,
               COALESCE(max_surveys, 0) AS max_surveys,
               COALESCE(max_surveyors, 0) AS max_surveyors,
               COALESCE(max_records, 0) AS max_records,
               COALESCE(max_categories, 5) AS max_categories
        FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
      `.catch(async () =>
      await sql`
          SELECT id, username, display_name, role, active, created_at, password_hash
          FROM app_users WHERE LOWER(username) = ${username} LIMIT 1
        `
    );
    const user = rows[0] as {
      id: number;
      username: string;
      display_name: string;
      role: string;
      active: boolean;
      created_at: string;
      password_hash: string;
    } | undefined;
    if (!user || !user.active) {
      return json({
        error: "Invalid username or password. Use the login Client Admin created for you.",
      }, 401);
    }
    // Only admin/super_admin (portal) or surveyor (field app). No public signup / legacy field/user.
    if (user.role !== "super_admin" && user.role !== "admin" && user.role !== "surveyor") {
      return json({
        error:
          "Account not allowed. Ask Client Admin to create a surveyor login for the field app.",
      }, 403);
    }
    // Field app must send expected_role=surveyor — rejects admin & wrong roles
    if (expectedRole === "surveyor") {
      if (user.role !== "surveyor") {
        return json({
          error:
            user.role === "admin"
              ? "Client Admin uses the web portal (/admin), not the field app."
              : "This login is not a surveyor account. Ask Client Admin for a field-app login.",
        }, 403);
      }
    }
    // Portal must send expected_role=admin
    if (expectedRole === "admin") {
      if (user.role !== "admin" && user.role !== "super_admin") {
        return json({
          error:
            "Client Admin portal only. Surveyors sign in on the field app with their app login.",
        }, 403);
      }
    }
    // Super Admin console (separate GitHub page) — server-enforced super_admin only
    if (expectedRole === "super_admin") {
      if (user.role !== "super_admin") {
        return json({
          error: "Super Admin console only. Client Admin uses the main portal.",
        }, 403);
      }
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return json({
        error: "Invalid username or password. Use the login Client Admin created for you.",
      }, 401);
    }

    // Super Admin: password + authenticator TOTP (3 slots). Client Admin / surveyor unchanged.
    if (user.role === "super_admin") {
      const totpCode = (body as { totp?: unknown }).totp ?? (body as { otp?: unknown }).otp;
      const rec = user as Record<string, unknown>;
      let secret = String(rec.totp_secret || "").trim();
      const enabled = sqlBool(rec.totp_enabled);
      if (!secret) {
        secret = newTotpSecret();
        await sql`UPDATE app_users SET totp_secret = ${secret}, totp_enabled = FALSE WHERE id = ${user.id}`
          .catch(() => null);
      }
      const totpOk = await verifyTotp(secret, totpCode);
      if (!totpOk) {
        return json({
          error: enabled
            ? "Enter the 6-digit code from your authenticator app."
            : "Scan the authenticator QR / secret, then enter the 6-digit code.",
          totp_required: true,
          totp_setup: !enabled,
          ...(enabled ? {} : totpSetupPayload(user.username, secret)),
        }, 401);
      }
      if (!enabled) {
        await sql`UPDATE app_users SET totp_enabled = TRUE WHERE id = ${user.id}`.catch(() => null);
      }
    }

    const token = newToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await sql`
        INSERT INTO app_sessions (token, user_id, expires_at)
        VALUES (${token}, ${user.id}, ${expires.toISOString()})
      `;
    logAudit(
      { id: user.id, username: user.username, role: user.role },
      "login",
      "user",
      user.id,
      { expected_role: expectedRole },
    );
    const uu = user as Record<string, unknown>;
    return json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.display_name || user.username,
        role: user.role,
        active: user.active,
        created_at: user.created_at,
        company_id: uu.company_id != null ? Number(uu.company_id) : null,
        company_name: uu.company_name ? String(uu.company_name) : null,
        key_id: uu.key_id || null,
        phone: uu.phone || null,
        verified: sqlBool(uu.verified),
        can_manage_questions: sqlBool(uu.can_manage_questions),
        can_edit_surveys: sqlBool(uu.can_edit_surveys),
        can_review_data: sqlBool(uu.can_review_data),
        can_verify_surveyors: sqlBool(uu.can_verify_surveyors),
        can_assign_surveyors: sqlBool(uu.can_assign_surveyors),
        can_crud_questionnaire: sqlBool(uu.can_crud_questionnaire),
        can_validate_proof: sqlBool(uu.can_validate_proof),
        can_web_survey: sqlBool(uu.can_web_survey),
        can_record_voice: sqlBool(uu.can_record_voice),
        can_translate_telugu: sqlBool(uu.can_translate_telugu),
        totp_enabled: uu.role === "super_admin" ? sqlBool(uu.totp_enabled) : undefined,
        max_questions_per_survey: Number(uu.max_questions_per_survey) || 0,
        max_surveys: Number(uu.max_surveys) || 0,
        max_surveyors: Number(uu.max_surveyors) || 0,
        max_records: Number(uu.max_records) || 0,
        max_categories: Number(uu.max_categories) || 0,
      },
      expires_at: expires.toISOString(),
      access:
        user.role === "surveyor"
          ? "surveyor_field_app"
          : user.role === "super_admin"
            ? "super_admin_portal"
            : "client_admin_portal",
      note:
        user.role === "surveyor"
          ? "Login created by Client Admin — field app only"
          : user.role === "super_admin"
            ? "Platform Super Admin — full access"
            : "Client Admin portal access",
    });
  }
  return null;
}

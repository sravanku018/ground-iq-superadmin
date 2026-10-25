import type { Ctx } from "./ctx.ts";
import {
  aliasesForQuestions,
  skipAnswerKey,
} from "../lib/analytics/answers.ts";
import {
  countAnalyticsRows,
  loadAnalyticsRows,
} from "../lib/analytics/loader.ts";
import {
  logAudit,
} from "../lib/audit.ts";
import {
  corsHeaders,
} from "../lib/cors.ts";
import {
  sql,
} from "../lib/db.ts";
import {
  json,
} from "../lib/http.ts";
import {
  EXPORT_FIXED_TE,
  toTeluguPlace,
  toTeluguValue,
} from "../lib/i18n-te.ts";
import {
  adminFormKeyScope,
} from "../lib/tenant.ts";
import {
  dayKey,
  formatIstStamp,
  istToday,
} from "../lib/time.ts";
import {
  isPortalAdmin,
} from "../lib/users.ts";
import {
  parseQuestionsArray,
} from "../lib/util.ts";

export async function handleExport(c: Ctx): Promise<Response | null> {
  const { req, url, path, method, me } = c;
  // Admin data export: text/CSV of submissions with photo + audio links.
  // Filters: period (total | today | day | month), day, month, user (surveyor),
  // survey (form_key), district, constituency, status (default confirmed).
  if (path === "/api/admin/export" && method === "GET") {
    if (!me) return json({ error: "Login required" }, 401);
    if (!isPortalAdmin(me.role)) return json({ error: "Admin only" }, 403);
    try {
      let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
      let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
      const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
      const dayParam = (url.searchParams.get("day") || "").trim();
      const monthParam = (url.searchParams.get("month") || "").trim();
      if (period === "today") {
        const t = istToday();
        dateFrom = t;
        dateTo = t;
      } else if (period === "day" && dayParam) {
        dateFrom = dayParam;
        dateTo = dayParam;
      } else if (period === "month" && monthParam) {
        const [y, m] = monthParam.split("-").map(Number);
        if (y && m) {
          const last = new Date(y, m, 0).getDate();
          dateFrom = `${monthParam}-01`;
          dateTo = `${monthParam}-${String(last).padStart(2, "0")}`;
        }
      }
      const userQ = (url.searchParams.get("user") || "").trim().toLowerCase();
      const surveyQ = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
      const districtQ = (url.searchParams.get("district") || "").trim().toLowerCase();
      const constituencyQ = (url.searchParams.get("constituency") || "").trim().toLowerCase();
      const statusQ = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();
      const langQ = (url.searchParams.get("lang") || url.searchParams.get("locale") || "en")
        .trim()
        .toLowerCase();
      const asTe = langQ === "te" || langQ === "telugu" || langQ === "te-in";

      const scope = await adminFormKeyScope(sql, me);
      const rowCount = await countAnalyticsRows(sql, scope);
      const allRows = await loadAnalyticsRows(sql, rowCount + 1000, scope);
      let rows = allRows;
      if (statusQ !== "all") rows = rows.filter((r) => r.status === statusQ);
      if (dateFrom) rows = rows.filter((r) => dayKey(r.created_at) >= dateFrom);
      if (dateTo) rows = rows.filter((r) => dayKey(r.created_at) <= dateTo);
      if (userQ) {
        rows = rows.filter((r) =>
          String(r.submitted_by || "").toLowerCase().includes(userQ)
        );
      }
      if (surveyQ) rows = rows.filter((r) => r.formKey === surveyQ);
      if (districtQ) {
        rows = rows.filter((r) => String(r.district || "").toLowerCase() === districtQ);
      }
      if (constituencyQ) {
        rows = rows.filter((r) => String(r.constituency || "").toLowerCase() === constituencyQ);
      }

      // Photo / audio links per submission (first of each kind).
      // survey_media.url is stored as a relative path ("/api/media/:id/file")
      // for Neon-hosted media — a CSV has no base origin, so a relative path
      // in an exported file is not a usable/clickable link. Make it absolute
      // using this request's own origin; external (R2) URLs are already
      // absolute and pass through unchanged.
      const origin = `${url.protocol}//${url.host}`;
      const mediaRows = await sql`
          SELECT id, submission_id, kind, url FROM survey_media
        `.catch(() => []);
      const photoUrl = new Map<number, string>();
      const audioUrl = new Map<number, string>();
      for (const m of mediaRows as {
        id: number;
        submission_id: number;
        kind: string;
        url: string | null;
      }[]) {
        const id = Number(m.submission_id);
        // Always the API file route so the browser never fetches R2 directly.
        const u = `${origin}/api/media/${Number(m.id)}/file`;
        if (m.kind === "photo" && !photoUrl.has(id)) photoUrl.set(id, u);
        if (m.kind === "audio" && !audioUrl.has(id)) audioUrl.set(id, u);
      }

      // Columns: fixed fields + union of all answer keys
      const photoName = (id: unknown) => `${id}/${id}.jpg`;
      const audioName = (id: unknown) => `${id}/${id}.webm`;
      const asMedia = (url.searchParams.get("format") || "").trim().toLowerCase() === "media";
      if (asMedia) {
        const items = rows.map((r) => ({
          id: r.id,
          photo_url: photoUrl.get(Number(r.id)) || "",
          audio_url: audioUrl.get(Number(r.id)) || "",
          photo_file: photoUrl.has(Number(r.id)) ? photoName(r.id) : "",
          audio_file: audioUrl.has(Number(r.id)) ? audioName(r.id) : "",
        }));
        return json({ items, count: items.length });
      }

      const fixed = [
        "id", "date", "created_at_ist", "survey", "surveyor", "district", "constituency", "mandal",
        "latitude", "longitude", "party", "gender", "caste", "age", "respondent",
        "photo_url", "audio_url", "photo_file", "audio_file",
      ];
      const idToLabel = new Map<string, string>();
      const optTeByKey = new Map<string, Map<string, string>>();
      const questionsByForm = new Map<string, { id: string; label: string }[]>();
      {
        const formRows = await sql`SELECT form_key, questions FROM survey_form`.catch(() => []);
        for (const f of formRows as { form_key?: string; questions?: unknown }[]) {
          const list: { id: string; label: string }[] = [];
          for (const raw of parseQuestionsArray(f.questions)) {
            const q = raw as Record<string, unknown>;
            const qid = String(q.id || "").trim();
            const labelEn = String(q.label || q.speak || qid).trim();
            const labelTe = String(q.label_te || "").trim();
            const label = asTe ? (labelTe || labelEn) : labelEn;
            const opts = Array.isArray(q.options) ? q.options.map((x) => String(x ?? "")) : [];
            const optsTe = Array.isArray(q.options_te) ? q.options_te.map((x) => String(x ?? "")) : [];
            const optMap = new Map<string, string>();
            opts.forEach((en, i) => {
              const te = String(optsTe[i] || "").trim();
              if (en && te) {
                optMap.set(en, te);
                optMap.set(en.toLowerCase(), te);
              }
            });
            if (qid && label) idToLabel.set(qid, label);
            if (qid && optMap.size) optTeByKey.set(qid, optMap);
            if (labelEn) list.push({ id: qid, label: labelEn });
          }
          questionsByForm.set(String(f.form_key || ""), list);
        }
      }
      const qKeys = new Set<string>();
      const bagsByForm = new Map<string, Record<string, unknown>[]>();
      for (const r of rows) {
        const fk = String(r.formKey || "");
        if (!bagsByForm.has(fk)) bagsByForm.set(fk, []);
        bagsByForm.get(fk)!.push(r.answers || {});
        for (const k of Object.keys(r.answers || {})) {
          if (!skipAnswerKey(k)) qKeys.add(k);
        }
      }
      for (const [fk, bags] of bagsByForm) {
        const qs = questionsByForm.get(fk) || [];
        for (const [qid, als] of aliasesForQuestions(qs, bags)) {
          const label = idToLabel.get(qid) || qs.find((q) => q.id === qid)?.label;
          const optMap = optTeByKey.get(qid);
          if (label) {
            for (const a of als) idToLabel.set(a, label);
          }
          if (optMap) {
            for (const a of als) optTeByKey.set(a, optMap);
          }
        }
      }
      const qCols = [...qKeys].sort((a, b) => {
        const na = /^q_(\d+)$/i.exec(a);
        const nb = /^q_(\d+)$/i.exec(b);
        if (na && nb) return Number(na[1]) - Number(nb[1]);
        return a.localeCompare(b);
      });
      const usedHeads = new Set<string>(fixed);
      const qHeaders = qCols.map((k) => {
        const head = idToLabel.get(k) || k;
        let unique = head;
        let n = 2;
        while (usedHeads.has(unique)) {
          unique = `${head} (${n})`;
          n += 1;
        }
        usedHeads.add(unique);
        return unique;
      });
      const orientation = (url.searchParams.get("orientation") || url.searchParams.get("layout") || "vertical").trim().toLowerCase();
      const isVertical = orientation !== "horizontal";

      const esc = (v: unknown) => {
        const s = String(v ?? "");
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines: string[] = [];

      const locVal = (key: string, v: unknown) => {
        if (!asTe) return Array.isArray(v) ? v.join(" | ") : v;
        if (
          key === "id" || key === "date" || key === "latitude" || key === "longitude" ||
          key === "photo_url" || key === "audio_url" || key === "photo_file" ||
          key === "audio_file" || key === "age" ||
          key === "created_at_ist"
        ) {
          return v;
        }
        if (key === "district" || key === "constituency" || key === "mandal" || key === "survey") {
          return toTeluguPlace(v);
        }
        return toTeluguValue(v);
      };
      const locAns = (c: string, v: unknown) =>
        asTe ? toTeluguValue(v, optTeByKey.get(c)) : (Array.isArray(v) ? v.join(" | ") : v);
      const fixedHead = (c: string) => (asTe ? EXPORT_FIXED_TE[c] || c : c);

      const getBaseRecord = (r: (typeof rows)[number]) => {
        const rObj = r as unknown as Record<string, unknown>;
        return {
          id: r.id,
          date: dayKey(r.created_at),
          created_at_ist: formatIstStamp(r.created_at),
          survey: r.formKey,
          surveyor: r.submitted_by,
          district: r.district,
          constituency: r.constituency,
          mandal: rObj.mandal || "",
          latitude: rObj.lat || "",
          longitude: rObj.lng || "",
          party: r.party,
          gender: r.gender,
          caste: r.caste,
          age: r.age,
          respondent: r.respondent,
          photo_url: photoUrl.get(Number(r.id)) || "",
          audio_url: audioUrl.get(Number(r.id)) || "",
          photo_file: photoUrl.has(Number(r.id)) ? photoName(r.id) : "",
          audio_file: audioUrl.has(Number(r.id)) ? audioName(r.id) : "",
        } as Record<string, unknown>;
      };

      if (isVertical) {
        // Vertical Layout: Transposed CSV (Questions / Attributes as Rows, Records as Columns)
        const recLabel = asTe ? "రికార్డ్" : "Record";
        const headerRow = [
          asTe ? "ఫీల్డ్ / ప్రశ్న" : "Field / Question",
          ...rows.map((r, idx) => `${recLabel} #${r.id || idx + 1}`),
        ];
        lines.push(headerRow.map(esc).join(","));

        // Fixed Metadata Fields (Rows)
        for (const c of fixed) {
          const rowVals = [fixedHead(c)];
          for (const r of rows) {
            const base = getBaseRecord(r);
            rowVals.push(esc(locVal(c, base[c])));
          }
          lines.push(rowVals.join(","));
        }

        // Dynamic Survey Questions (Rows)
        qCols.forEach((c, idx) => {
          const qHeader = qHeaders[idx] || c;
          const rowVals = [esc(qHeader)];
          for (const r of rows) {
            const v = (r.answers || {})[c];
            rowVals.push(esc(locAns(c, v)));
          }
          lines.push(rowVals.join(","));
        });
      } else {
        // Horizontal Layout: Standard CSV (One row per record)
        lines.push([...fixed.map(fixedHead), ...qHeaders].map(esc).join(","));
        for (const r of rows) {
          const base = getBaseRecord(r);
          const rec: string[] = [];
          for (const c of fixed) rec.push(esc(locVal(c, base[c])));
          for (const c of qCols) {
            const v = (r.answers || {})[c];
            rec.push(esc(locAns(c, v)));
          }
          lines.push(rec.join(","));
        }
      }
      logAudit(me, "data_export", "export", null, {
        rows: rows.length,
        status: statusQ,
        from: dateFrom,
        to: dateTo,
        lang: asTe ? "te" : "en",
      });
      const stamp = dayParam || monthParam || "total";
      const fname = asTe ? `survey-export-te-${stamp}.csv` : `survey-export-${stamp}.csv`;
      const csvBody = (asTe ? "\uFEFF" : "") + lines.join("\n");
      return new Response(csvBody, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fname}"`,
          ...corsHeaders(req),
        },
      });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }
  return null;
}

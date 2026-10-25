import {
  hasPower,
} from "./survey-assignments.ts";

/** Telugu add / type / auto-translate — Super Admin grant `can_translate_telugu`. */
export function canTranslateTelugu(
  me: { role: unknown } & Record<string, unknown> | null,
): boolean {
  return hasPower(me, "can_translate_telugu");
}

/** Copy question-bank templates into a survey. */
export function canQuestionCopy(
  me: { role: unknown } & Record<string, unknown> | null,
): boolean {
  return hasPower(me, "can_manage_questions") || hasPower(me, "can_crud_questionnaire");
}

export function stripTeluguUnlessAllowed(
  me: { role: unknown } & Record<string, unknown> | null,
  questions: unknown[],
): unknown[] {
  if (canTranslateTelugu(me)) return questions;
  return questions.map((q) => {
    if (!q || typeof q !== "object") return q;
    const rec = { ...(q as Record<string, unknown>) };
    delete rec.label_te;
    delete rec.options_te;
    delete rec.options_te_text;
    return rec;
  });
}

export function decodeTranslateHtml(s: string): string {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Google Translate (official Cloud key, else public translate endpoint). */
export async function googleTranslateToTelugu(texts: string[]): Promise<string[]> {
  const items = texts.map((t) => String(t || ""));
  if (!items.length) return [];
  const official =
    Deno.env.get("GOOGLE_TRANSLATE_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "";
  if (official) {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(official)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: items, source: "en", target: "te", format: "text" }),
      },
    );
    const data = await res.json().catch(() => ({})) as {
      data?: { translations?: { translatedText?: string }[] };
      error?: { message?: string };
    };
    if (!res.ok) {
      const err = new Error(data.error?.message || `Google Translate failed (${res.status})`);
      (err as { status?: number }).status = 502;
      throw err;
    }
    const rows = data.data?.translations || [];
    return items.map((_, i) => decodeTranslateHtml(String(rows[i]?.translatedText || "")));
  }

  const out: string[] = [];
  for (const t of items) {
    if (!t.trim()) {
      out.push("");
      continue;
    }
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=te&dt=t&q=${encodeURIComponent(t)}`;
    const res = await fetch(url);
    const arr = await res.json().catch(() => null) as unknown;
    if (!res.ok || !Array.isArray(arr)) {
      const err = new Error(`Google Translate failed (${res.status})`);
      (err as { status?: number }).status = 502;
      throw err;
    }
    const chunks = Array.isArray(arr[0]) ? arr[0] : [];
    const te = chunks.map((c) => (Array.isArray(c) ? String(c[0] || "") : "")).join("");
    out.push(te.trim());
  }
  return out;
}

export async function translateQuestionToTelugu(
  text: string,
  options: string[],
): Promise<{ text_te: string; options_te: string[] }> {
  try {
    const batch = [text, ...options];
    const te = await googleTranslateToTelugu(batch);
    return { text_te: te[0] || "", options_te: te.slice(1) };
  } catch (googleErr) {
    const xai = Deno.env.get("XAI_API_KEY") || "";
    if (!xai) throw googleErr;
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${xai}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              'Translate English survey questions into Telugu (te-IN). Reply with JSON only: {"text_te":"...","options_te":[...]}. options_te must match the input options in length and order. Keep numbers and party names readable.',
          },
          { role: "user", content: JSON.stringify({ text, options }) },
        ],
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw googleErr;
    let parsed: { choices?: { message?: { content?: string } }[] } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw googleErr;
    }
    let content = String(parsed.choices?.[0]?.message?.content || "").trim();
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const out = JSON.parse(content) as { text_te?: string; options_te?: unknown };
    const optionsTe = Array.isArray(out.options_te)
      ? out.options_te.map((s) => String(s ?? ""))
      : [];
    return { text_te: String(out.text_te || "").trim(), options_te: optionsTe };
  }
}


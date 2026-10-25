import {
  aliasesForQuestions,
  answerOf,
  answersByQuestionId,
  compareSets,
  countBy,
  pctDist,
  slugQuestionKeyServer,
  softEq,
  withPct,
} from "./answers.ts";
import {
  countAnalyticsRows,
  loadAnalyticsRows,
} from "./loader.ts";
import {
  sql,
} from "../db.ts";
import {
  CHOICE_Q_TYPES,
  chartNamesFromAnswer,
  coerceOptionName,
  defaultQuestionOptions,
  optionTeMap,
  toTeluguPlace,
  toTeluguValue,
  withTeLabels,
} from "../i18n-te.ts";
import {
  isWebSource,
} from "../inbox.ts";
import {
  collectTimeStats,
  dayKey,
  istToday,
} from "../time.ts";
import {
  type Row,
} from "../verify.ts";

export async function buildAnalytics(
  sqlFn: NonNullable<typeof sql>,
  url: URL,
  scopeKeys: string[] | null = null,
) {
  const district = (url.searchParams.get("district") || "").trim();
  const party = (url.searchParams.get("party") || "").trim();
  const gender = (url.searchParams.get("gender") || "").trim();
  const caste = (url.searchParams.get("caste") || "").trim();
  const constituency = (url.searchParams.get("constituency") || "").trim();
  // Report pipeline: default analytics = confirmed only
  // report=locked → field charts stay confirmed+complete; pending web fills are included.
  const reportLocked = (url.searchParams.get("report") || "").trim().toLowerCase() === "locked";
  let statusFilter = (url.searchParams.get("status") || "confirmed").trim().toLowerCase();
  let completenessFilter = (url.searchParams.get("completeness") || "all").trim().toLowerCase();
  if (reportLocked) {
    completenessFilter = "complete";
  }
  let dateFrom = (url.searchParams.get("date_from") || url.searchParams.get("from") || "").trim();
  let dateTo = (url.searchParams.get("date_to") || url.searchParams.get("to") || "").trim();
  const userFilter = (url.searchParams.get("user") || url.searchParams.get("submitted_by") || "").trim();
  const sourceFilter = (url.searchParams.get("source") || "").trim().toLowerCase();
  let formFilter = (url.searchParams.get("survey") || url.searchParams.get("form_key") || "").trim();
  // Client Admin: never load another tenant's questionnaire via a guessable form_key.
  // Super Admin (scopeKeys = null) may still select any survey.
  if (scopeKeys && formFilter && !scopeKeys.includes(formFilter)) {
    formFilter = "";
  }
  // period: total | day | month | today — Client Admin data scopes
  const period = (url.searchParams.get("period") || "total").trim().toLowerCase();
  const dayParam = (url.searchParams.get("day") || "").trim(); // YYYY-MM-DD
  const monthParam = (url.searchParams.get("month") || "").trim(); // YYYY-MM
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
  // period=total → leave dateFrom/dateTo as provided (or empty = all time)

  const rowCount = await countAnalyticsRows(sqlFn, scopeKeys);
  const allRows = await loadAnalyticsRows(sqlFn, rowCount + 1000, scopeKeys);

  const statusCounts = {
    pending: allRows.filter((r) => r.status === "pending").length,
    confirmed: allRows.filter((r) => r.status === "confirmed").length,
    rejected: allRows.filter((r) => r.status === "rejected").length,
    total: allRows.length,
  };

  // Analytics universe: confirmed report by default (after Q/A confirm).
  // Locked dashboard: confirmed field + pending/confirmed web (not rejected).
  let universe = allRows;
  if (reportLocked) {
    universe = allRows.filter((r) => {
      if (r.status === "rejected") return false;
      if (isWebSource(r.source)) return r.status === "pending" || r.status === "confirmed";
      return r.status === "confirmed";
    });
  } else if (statusFilter === "confirmed") {
    universe = allRows.filter((r) => r.status === "confirmed");
  } else if (statusFilter === "pending") {
    universe = allRows.filter((r) => r.status === "pending");
  } else if (statusFilter === "rejected") {
    universe = allRows.filter((r) => r.status === "rejected");
  }
  // status=all → full universe

  // Client Admin: date + user scope before charts
  if (dateFrom) {
    universe = universe.filter((r) => dayKey(r.created_at) >= dateFrom);
  }
  if (dateTo) {
    universe = universe.filter((r) => dayKey(r.created_at) <= dateTo);
  }
  if (userFilter) {
    const uf = userFilter.toLowerCase();
    universe = universe.filter((r) =>
      String(r.submitted_by || "").toLowerCase().includes(uf)
    );
  }
  if (formFilter) {
    universe = universe.filter((r) =>
      String(r.formKey || "") === formFilter
    );
  }
  if (sourceFilter === "web") {
    universe = universe.filter((r) => {
      const src = String(r.source || "");
      return src === "web-survey" || src === "web";
    });
  } else if (sourceFilter === "field" || sourceFilter === "app") {
    universe = universe.filter((r) => {
      const src = String(r.source || "");
      return src !== "web-survey" && src !== "web";
    });
  }

  // Survey questions → dynamic filter bar (options from defined choices + submitted answers)
  const surveyQuestions: {
    id: string;
    label: string;
    label_te: string;
    type: string;
    category: string;
    visible: boolean;
    options: string[];
    authored: string[];
    options_te: string[];
    aliases: string[];
    optTe: Map<string, string>;
  }[] = [];
  {
    // Never pull platform `legacy` / `default` into a new account's filter bar
    // unless that survey is explicitly selected (or it is the only scoped key).
    const PLATFORM_FORM_KEYS = new Set(["default", "legacy"]);
    let formRows: { questions?: unknown }[] = [];
    if (formFilter) {
      formRows = scopeKeys
        ? await sqlFn`
            SELECT form_key, questions FROM survey_form
            WHERE form_key = ${formFilter} AND form_key = ANY(${scopeKeys})
            LIMIT 1
          `.catch(() => [])
        : await sqlFn`
            SELECT form_key, questions FROM survey_form WHERE form_key = ${formFilter} LIMIT 1
          `.catch(() => []);
    } else {
      const scoped = Array.isArray(scopeKeys)
        ? scopeKeys.map(String).filter(Boolean)
        : [];
      const keysInData = [
        ...new Set(
          universe.map((r) => String(r.formKey || "")).filter(Boolean),
        ),
      ];
      // Keep any survey that actually has rows in this report (including
      // legacy/default). Only hide platform forms when they have no data —
      // that is what made Analyze charts disappear after we dropped them.
      let keys = scoped.length ? scoped : keysInData;
      if (!keys.length && !scopeKeys) {
        keys = [];
      }
      keys = keys.filter(
        (k) => !PLATFORM_FORM_KEYS.has(k) || keysInData.includes(k),
      );
      if (!keys.length) keys = keysInData;
      if (keys.length) {
        formRows = await sqlFn`
          SELECT form_key, questions FROM survey_form WHERE form_key = ANY(${keys})
        `.catch(() => []);
      }
    }
    const seen = new Set<string>();
    const parsedForms: { form_key: string; qs: Record<string, unknown>[] }[] = [];
    for (const frow of formRows as { form_key?: string; questions?: unknown }[]) {
      let qs = frow?.questions;
      if (typeof qs === "string") {
        try { qs = JSON.parse(qs); } catch { qs = []; }
      }
      if (!Array.isArray(qs)) continue;
      parsedForms.push({
        form_key: String(frow.form_key || ""),
        qs: qs as Record<string, unknown>[],
      });
    }
    const aliasesById = new Map<string, string[]>();
    for (const form of parsedForms) {
      const qs = form.qs.map((q) => ({
        id: String(q.id || slugQuestionKeyServer(String(q.label || ""))).trim(),
        label: String(q.label || "").trim(),
      })).filter((q) => q.id);
      const bags = universe
        .filter((r) => !form.form_key || String(r.formKey || "") === form.form_key)
        .map((r) => r.answers || {});
      for (const [qid, als] of aliasesForQuestions(qs, bags)) {
        const prev = aliasesById.get(qid) || [];
        for (const a of als) if (!prev.includes(a)) prev.push(a);
        aliasesById.set(qid, prev);
      }
    }
    for (const form of parsedForms) {
      for (const q of form.qs) {
        const id = String(q.id || "").trim() || slugQuestionKeyServer(String(q.label || ""));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const type = String(q.type || "text");
        const defined = Array.isArray(q.options)
          ? q.options.map(coerceOptionName).filter(Boolean)
          : [];
        const aliases = aliasesById.get(id) || [];
        const opts: string[] = [];
        const authored: string[] = [];
        const pushOpt = (name: string, intoAuthored = false) => {
          const n = String(name || "").trim();
          if (!n) return;
          if (!opts.some((o) => o.toLowerCase() === n.toLowerCase())) opts.push(n);
          if (
            intoAuthored &&
            !authored.some((o) => o.toLowerCase() === n.toLowerCase())
          ) {
            authored.push(n);
          }
        };
        // Authored choices only. Type defaults fill in when the form has none.
        if (defined.length) {
          for (const d of defined) pushOpt(d, true);
        } else {
          for (const d of defaultQuestionOptions(type)) pushOpt(d, true);
        }
        for (const r of universe) {
          const av = answerOf(r.answers, id, String(q.label || ""), aliases);
          for (const n of chartNamesFromAnswer(type, av, opts)) pushOpt(n, false);
        }
        const optionsTe = Array.isArray(q.options_te) ? q.options_te.map(String) : [];
        const optTe = optionTeMap(defined.length ? defined : authored, optionsTe);
        surveyQuestions.push({
          id,
          label: String(q.label || "").trim() || "Question",
          label_te: String(q.label_te || "").trim(),
          type,
          category: String(q.category || "").trim(),
          visible: q.visible !== false,
          options: opts,
          authored,
          options_te: optionsTe,
          aliases,
          optTe,
        });
      }
    }
  }

  // Dynamic filters: q_<questionId>=value (driven by survey questions)
  const dynFilters = new Map<string, string>();
  for (const [k, v] of url.searchParams) {
    if (k.startsWith("q_") && v) dynFilters.set(k.slice(2), v);
  }
  if (dynFilters.size) {
    universe = universe.filter((r) => {
      const bag = answersByQuestionId(r.answers, surveyQuestions);
      for (const [qid, want] of dynFilters) {
        const q = surveyQuestions.find((sq) => sq.id === qid || sq.aliases.includes(qid));
        const av = q ? bag.get(q.id) : answerOf(r.answers, qid, q?.label, q?.aliases);
        const names = chartNamesFromAnswer(q?.type || "", av, q?.options || []);
        const hit = names.some((n) => n === want) ||
          (Array.isArray(av) ? av.map(String).includes(want) : String(av ?? "") === want);
        if (!hit) return false;
      }
      return true;
    });
  }

  // Survey titles for the by_survey board (participants + locations per survey)
  const surveyTitles = new Map<string, string>();
  {
    const trows = scopeKeys
      ? await sqlFn`
          SELECT form_key, title FROM survey_form WHERE form_key = ANY(${scopeKeys})
        `.catch(() => [])
      : await sqlFn`SELECT form_key, title FROM survey_form`.catch(() => []);
    for (const t of trows as { form_key?: string; title?: string }[]) {
      surveyTitles.set(String(t.form_key || ""), String(t.title || ""));
    }
  }
  if (completenessFilter === "complete") {
    universe = universe.filter((r) => r.completeness === "complete");
  } else if (completenessFilter === "incomplete") {
    universe = universe.filter((r) => r.completeness === "incomplete");
  }

  const totalAll = universe.length;
  const filterOptions = {
    districts: [...new Set(universe.map((r) => r.district).filter((d) => d && d !== "Unknown"))].sort(),
    parties: [...new Set(universe.map((r) => r.party))].sort(),
    genders: [...new Set(universe.map((r) => r.gender))].sort(),
    castes: [...new Set(universe.map((r) => r.caste))].sort(),
    constituencies: [
      ...new Set(universe.map((r) => r.constituency).filter((c) => c && c !== "Unknown")),
    ]
      .sort()
      .slice(0, 200),
    statuses: ["confirmed", "pending", "rejected", "all"],
    users: [...new Set(universe.map((r) => r.submitted_by).filter(Boolean))].sort().slice(0, 200),
    completeness: ["complete", "incomplete", "all"],
  };

  let subset = universe;
  if (district) subset = subset.filter((r) => softEq(r.district, district));
  if (party) subset = subset.filter((r) => r.party === party);
  if (gender) subset = subset.filter((r) => r.gender === gender);
  if (caste) subset = subset.filter((r) => r.caste === caste);
  if (constituency) subset = subset.filter((r) => softEq(r.constituency, constituency));

  const isFiltered = subset.length < universe.length;
  const subsetIds = new Set(subset.map((r) => r.id));
  const restRows = universe.filter((r) => !subsetIds.has(r.id));
  const rows = subset;

  const countKey = (list: Row[], key: keyof Row) =>
    withPct(
      countBy(
        list.map((r) => ({ key: String(r[key]) })),
        (r) => r.key,
      ),
    );

  const byParty = withTeLabels(countKey(rows, "party"), "value");
  // ALL districts with data for maps (no artificial top-N cut that hides small districts)
  const byDistrictRaw = countBy(
    rows.map((r) => ({ key: r.district })),
    (r) => r.key,
  );
  const byDistrict = withTeLabels(
    withPct(byDistrictRaw.filter((d) => d.name !== "Unknown")),
    "place",
  );
  const byGender = withTeLabels(countKey(rows, "gender"), "value");
  const byCaste = withTeLabels(countKey(rows, "caste"), "value");
  const byPm = withTeLabels(countKey(rows, "pm"), "value");
  const byPerformance = withTeLabels(countKey(rows, "performance").slice(0, 10), "value");
  const byEducation = withTeLabels(countKey(rows, "education").slice(0, 10), "value");
  const byEmployment = withTeLabels(countKey(rows, "employment").slice(0, 10), "value");
  // Full AC list for assembly map coloring (not just top 12)
  const byConstituency = withTeLabels(
    withPct(
      countBy(
        rows.filter((r) => r.constituency !== "Unknown").map((r) => ({ key: r.constituency })),
        (r) => r.key,
      ),
    ),
    "place",
  );
  const byAge = withTeLabels(countKey(rows, "age"), "value");
  const byMp = withTeLabels(
    withPct(
      countBy(
        rows.filter((r) => r.mp).map((r) => ({ key: r.mp })),
        (r) => r.key,
      ),
    ),
    "place",
  );

  const issueMap = new Map<string, number>();
  for (const r of rows) {
    for (const iss of r.issues) {
      const name = String(iss).trim();
      if (!name) continue;
      issueMap.set(name, (issueMap.get(name) || 0) + 1);
    }
  }
  const issues = withTeLabels(
    withPct(
      [...issueMap.entries()]
        .map(([name, value]) => ({ name, value, pct: 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    ),
    "value",
  );

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = (r.created_at || "").slice(0, 10);
    if (!day) continue;
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const timeline = [...dayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-60);

  function meterStatsForQuestion(
    q: (typeof surveyQuestions)[number],
    list: Row[],
  ): { avg: number; n: number } | null {
    if (q.type !== "meter" && q.type !== "tapometer") return null;
    const nums: number[] = [];
    for (const r of list) {
      const av = answersByQuestionId(r.answers, surveyQuestions).get(q.id);
      const n = Number(String(av ?? "").replace("%", "").replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(n) && n > 0) nums.push(Math.min(100, Math.max(1, n)));
    }
    if (!nums.length) return { avg: 0, n: 0 };
    const avg = Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 10) / 10;
    return { avg, n: nums.length };
  }

  function countsForQuestion(
    q: (typeof surveyQuestions)[number],
    list: Row[],
  ) {
    const map = new Map<string, number>();
    const seed = q.authored?.length ? q.authored : q.options;
    const choice = CHOICE_Q_TYPES.has(q.type) || (q.type !== "text" && seed.length > 0);
    if (choice) {
      for (const opt of seed) map.set(opt, 0);
    }
    for (const r of list) {
      const av = answersByQuestionId(r.answers, surveyQuestions).get(q.id);
      for (const name of chartNamesFromAnswer(q.type, av, q.options)) {
        map.set(name, (map.get(name) || 0) + 1);
      }
    }
    const order = q.options;
    let entries = [...map.entries()];
    entries.sort((a, b) => {
      const ia = order.findIndex((o) => o.toLowerCase() === a[0].toLowerCase());
      const ib = order.findIndex((o) => o.toLowerCase() === b[0].toLowerCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    if (!choice && entries.length > 50) {
      entries = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 50);
    }
    return withTeLabels(
      withPct(entries.map(([name, value]) => ({ name, value, pct: 0 }))),
      "value",
      q.optTe,
    );
  }

  // Per-question charts: every survey question, every defined option (0 counts stay visible).
  const questionCharts = surveyQuestions.filter((q) => q.visible).map((q) => ({
    id: q.id,
    label: q.label,
    label_en: q.label,
    label_te: q.label_te || "",
    type: q.type,
    category: q.category,
    visible: q.visible,
    options: q.options,
    authored: q.authored,
    counts: countsForQuestion(q, rows),
    meter: meterStatsForQuestion(q, rows),
  }));

  // Cross-tabs for maps
  const partyOrder = ["Congress", "BJP", "BRS", "Others", "Undecided"];
  function crossTab(list: Row[], rowKey: keyof Row, colKey: keyof Row) {
    const rowMap = new Map<string, Record<string, number | string>>();
    for (const r of list) {
      const rk = String(r[rowKey] || "Unknown");
      const ck = String(r[colKey] || "Unknown");
      if (!rowMap.has(rk)) rowMap.set(rk, { name: rk, total: 0 });
      const row = rowMap.get(rk)!;
      row[ck] = Number(row[ck] || 0) + 1;
      row.total = Number(row.total || 0) + 1;
    }
    const seen = new Set<string>();
    for (const r of rowMap.values()) {
      for (const k of Object.keys(r)) {
        if (k !== "name" && k !== "total") seen.add(k);
      }
    }
    const extra = [...seen].filter((c) => !partyOrder.includes(c)).sort();
    const columns = [...partyOrder, ...extra];
    const outRows = [...rowMap.values()]
      .map((r) => {
        for (const c of columns) if (r[c] == null) r[c] = 0;
        return r;
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    return { columns, rows: outRows };
  }

  const partyByDistrict = crossTab(rows, "district", "party");
  const partyByDistrictChart = {
    columns: partyByDistrict.columns,
    column_labels: Object.fromEntries(
      partyByDistrict.columns.map((c) => [c, toTeluguValue(c)]),
    ),
    rows: partyByDistrict.rows.slice(0, 12).map((r) => ({
      ...r,
      label: toTeluguPlace(String(r.name || "")),
    })),
  };
  const partyByCaste = crossTab(rows, "caste", "party");
  const partyByGender = crossTab(rows, "gender", "party");
  const partyByConstituency = crossTab(
    rows.filter((r) => r.constituency !== "Unknown"),
    "constituency",
    "party",
  );
  const partyByMp = crossTab(
    rows.filter((r) => r.mp),
    "mp",
    "party",
  );

  const contrastParty = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "party"), pctDist(restRows, "party"), pctDist(universe, "party")), "value")
    : [];
  const contrastGender = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "gender"), pctDist(restRows, "gender"), pctDist(universe, "gender")), "value")
    : [];
  const contrastCaste = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "caste"), pctDist(restRows, "caste"), pctDist(universe, "caste")), "value")
    : [];
  const contrastPm = isFiltered
    ? withTeLabels(compareSets(pctDist(subset, "pm"), pctDist(restRows, "pm"), pctDist(universe, "pm")), "value")
    : [];
  const contrastConstituency = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
          pctDist(restRows.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
          pctDist(universe.filter((r) => r.constituency && r.constituency !== "Unknown"), "constituency"),
        ).slice(0, 25),
        "place",
      )
    : [];
  const contrastDistrict = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.district && r.district !== "Unknown"), "district"),
          pctDist(restRows.filter((r) => r.district && r.district !== "Unknown"), "district"),
          pctDist(universe.filter((r) => r.district && r.district !== "Unknown"), "district"),
        ),
        "place",
      )
    : [];
  const contrastMp = isFiltered
    ? withTeLabels(
        compareSets(
          pctDist(subset.filter((r) => r.mp), "mp"),
          pctDist(restRows.filter((r) => r.mp), "mp"),
          pctDist(universe.filter((r) => r.mp), "mp"),
        ),
        "place",
      )
    : [];

  const topParty = byParty[0];
  const topIssue = issues[0];
  const topDistrict = byDistrict[0];

  return {
    collectTime: collectTimeStats(rows),
    totalAll,
    filtered: rows.length,
    restCount: restRows.length,
    isFiltered,
    reportStatus: statusFilter,
    reportLocked,
    statusCounts,
    completenessCounts: {
      complete: universe.filter((r) => r.completeness === "complete").length,
      incomplete: universe.filter((r) => r.completeness === "incomplete").length,
    },
    pipeline: {
      step: "1 Users → 2 Collect → 3 Verify geo+voice → 4 Client Admin confirms → 5 Report forms",
      analytics_on: statusFilter,
      note: reportLocked
        ? "Dashboard: confirmed field records plus pending and confirmed web fills."
        : statusFilter === "confirmed"
        ? "Report uses confirmed surveys. GPS + photo + Q/A required; voice only when Super Admin/Client Admin set it required."
        : `Analytics scope: ${statusFilter}`,
    },
    filters: {
      district,
      party,
      gender,
      caste,
      constituency,
      status: statusFilter,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      user: userFilter || null,
      survey: formFilter || null,
      completeness: completenessFilter,
      period,
      day: dayParam || null,
      month: monthParam || null,
    },
    // Client Admin summaries: daily / monthly / surveyor daily / surveyor monthly
    dataFilters: {
      period,
      total: universe.length,
      by_user: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const u = r.submitted_by || "unknown";
          map.set(u, (map.get(u) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({
            name,
            value,
            pct: universe.length
              ? Math.round((value / universe.length) * 1000) / 10
              : 0,
          }))
          .sort((a, b) => b.value - a.value);
      })(),
      by_day: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const d = dayKey(r.created_at) || "unknown";
          map.set(d, (map.get(d) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      by_month: (() => {
        const map = new Map<string, number>();
        for (const r of universe) {
          const m = dayKey(r.created_at).slice(0, 7) || "unknown";
          map.set(m, (map.get(m) || 0) + 1);
        }
        return [...map.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.name.localeCompare(a.name));
      })(),
      // Surveyor × day (each surveyor's daily totals)
      by_surveyor_day: (() => {
        const map = new Map<string, { surveyor: string; day: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const day = dayKey(r.created_at) || "unknown";
          const key = `${surveyor}::${day}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, day, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const d = b.day.localeCompare(a.day);
          if (d !== 0) return d;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
      // Dynamic per-question filter dropdowns (from the selected survey).
      // Counts come from `subset` (all active filters applied — district/party/
      // gender/caste/q_* included) so the numbers shown next to each option
      // match what the charts are currently displaying, not the unfiltered universe.
      questions: surveyQuestions.filter((q) => q.visible).map((q) => ({
        id: q.id,
        label: q.label,
        label_en: q.label,
        label_te: q.label_te || "",
        type: q.type,
        category: q.category,
        visible: q.visible,
        options: q.options,
        authored: q.authored,
        options_te: q.options_te,
        counts: countsForQuestion(q, subset),
        meter: meterStatsForQuestion(q, subset),
      })),
      // Surveyor × month (each surveyor's monthly totals)
      by_surveyor_month: (() => {
        const map = new Map<string, { surveyor: string; month: string; value: number }>();
        for (const r of universe) {
          const surveyor = r.submitted_by || "unknown";
          const month = dayKey(r.created_at).slice(0, 7) || "unknown";
          const key = `${surveyor}::${month}`;
          const cur = map.get(key);
          if (cur) cur.value += 1;
          else map.set(key, { surveyor, month, value: 1 });
        }
        return [...map.values()].sort((a, b) => {
          const m = b.month.localeCompare(a.month);
          if (m !== 0) return m;
          return b.value - a.value || a.surveyor.localeCompare(b.surveyor);
        });
      })(),
      // By survey: submissions, participating surveyors, locations covered
      by_survey: (() => {
        type SurveyStat = {
          name: string;
          title: string;
          value: number;
          surveyors: Set<string>;
          districts: Set<string>;
          constituencies: Set<string>;
        };
        const map = new Map<string, SurveyStat>();
        for (const r of universe) {
          const key = r.formKey || "default";
          let row = map.get(key);
          if (!row) {
            row = {
              name: key,
              title: surveyTitles.get(key) || key,
              value: 0,
              surveyors: new Set(),
              districts: new Set(),
              constituencies: new Set(),
            };
            map.set(key, row);
          }
          row.value += 1;
          if (r.submitted_by) row.surveyors.add(r.submitted_by);
          if (r.district && r.district !== "Unknown") row.districts.add(r.district);
          if (r.constituency && r.constituency !== "Unknown") {
            row.constituencies.add(r.constituency);
          }
        }
        return [...map.values()]
          .map((s) => ({
            name: s.name,
            title: s.title,
            value: s.value,
            surveyors: [...s.surveyors].sort(),
            districts: [...s.districts].sort(),
            constituencies: [...s.constituencies].sort(),
          }))
          .sort((a, b) => b.value - a.value);
      })(),
    },
    filterOptions,
    filterLabels: {
      districts: Object.fromEntries(
        (filterOptions.districts as string[]).map((n) => [n, toTeluguPlace(n)]),
      ),
      parties: Object.fromEntries(
        (filterOptions.parties as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      genders: Object.fromEntries(
        (filterOptions.genders as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      castes: Object.fromEntries(
        (filterOptions.castes as string[]).map((n) => [n, toTeluguValue(n)]),
      ),
      constituencies: Object.fromEntries(
        (filterOptions.constituencies as string[]).map((n) => [n, toTeluguPlace(n)]),
      ),
    },
    formula: {
      name: "Super-set / Sub-set",
      description:
        "Subset = filtered selection. Superset = confirmed (or selected status) surveys. Rest = Superset − Subset. Δpp = Subset% − Rest%. Index = Subset% / Superset%.",
      superset_n: totalAll,
      subset_n: subset.length,
      rest_n: restRows.length,
      is_filtered: isFiltered,
      equations: [
        "Subset% = count_in_subset / |subset| × 100",
        "Rest% = count_in_rest / |rest| × 100",
        "Δpp = Subset% − Rest%",
        "Index = Subset% / Superset%",
      ],
    },
    insights: {
      topParty: topParty
        ? `${topParty.name} leads with ${topParty.pct}% (${topParty.value})`
        : "No party data",
      topIssue: topIssue ? `Top issue: ${topIssue.name} (${topIssue.value})` : "No issues tagged",
      topDistrict: topDistrict
        ? `Most responses: ${topDistrict.name} (${topDistrict.value})`
        : "No district data",
      coverage: `${rows.length.toLocaleString()} of ${totalAll.toLocaleString()} records`,
      contrast:
        isFiltered && contrastParty[0]
          ? `Subset vs Rest: ${contrastParty[0].name} Δ ${
            contrastParty[0].delta > 0 ? "+" : ""
          }${contrastParty[0].delta}pp`
          : "Apply a filter to compare Subset vs Superset/Rest",
    },
    // Category order for the dashboard: first appearance across the survey's questions.
    questionCategories: (() => {
      const order: string[] = [];
      const counts = new Map<string, number>();
      for (const q of surveyQuestions) {
        if (!q.visible || !q.category) continue;
        if (!counts.has(q.category)) {
          counts.set(q.category, 0);
          order.push(q.category);
        }
        counts.set(q.category, (counts.get(q.category) || 0) + 1);
      }
      return order.map((name) => ({ name, question_count: counts.get(name) || 0 }));
    })(),
    charts: {
      byParty,
      byDistrict,
      byGender,
      byCaste,
      byPm,
      byPerformance,
      byEducation,
      byEmployment,
      byConstituency,
      byAge,
      byMp,
      issues,
      timeline,
      questionCharts,
      partyByDistrict: partyByDistrictChart,
      partyByDistrictFull: partyByDistrict,
      partyByConstituency,
      partyByMp,
      partyByCaste,
      partyByGender,
      contrastParty,
      contrastGender,
      contrastCaste,
      contrastPm,
      contrastConstituency,
      contrastDistrict,
      contrastMp,
    },
  };
}


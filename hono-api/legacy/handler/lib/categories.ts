import {
  sql,
} from "./db.ts";
import {
  parseQuestionsArray,
} from "./util.ts";

// ── Question categories (owned by each Client Admin, limited by Super Admin) ──

export type QuestionCategory = {
  id: number;
  name: string;
  company_id: number | null;
  created_by: number | null;
  created_at: string;
};

/** A company's admins share one vocabulary; an admin without a company owns theirs alone. */
export function categoryTenantOf(me: { id: unknown; company_id: unknown }): {
  companyId: number | null;
  adminId: number;
} {
  const cid = Number(me.company_id);
  return {
    companyId: Number.isFinite(cid) && cid > 0 ? cid : null,
    adminId: Number(me.id),
  };
}

export async function listOwnedCategories(
  sqlFn: NonNullable<typeof sql>,
  tenant: { companyId: number | null; adminId: number },
): Promise<QuestionCategory[]> {
  const rows =
    tenant.companyId != null
      ? await sqlFn`
          SELECT id, name, company_id, created_by, created_at
          FROM question_categories WHERE company_id = ${tenant.companyId}
        `.catch(() => [])
      : await sqlFn`
          SELECT id, name, company_id, created_by, created_at
          FROM question_categories
          WHERE company_id IS NULL AND created_by = ${tenant.adminId}
        `.catch(() => []);
  return (rows as QuestionCategory[]).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** What the caller may tag questions with. Super Admin browses every tenant's list. */
export async function listVisibleCategories(
  sqlFn: NonNullable<typeof sql>,
  me: { id: unknown; company_id: unknown; role: string },
): Promise<QuestionCategory[]> {
  if (me.role === "super_admin") {
    const rows = await sqlFn`
      SELECT id, name, company_id, created_by, created_at FROM question_categories
    `.catch(() => []);
    return (rows as QuestionCategory[]).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return listOwnedCategories(sqlFn, categoryTenantOf(me));
}

/** Surveys of the tenant that owns a category — the blast radius for a rename. */
export async function surveysForCategoryTenant(
  sqlFn: NonNullable<typeof sql>,
  tenant: { companyId: number | null; adminId: number },
): Promise<{ id: number; questions: unknown }[]> {
  const rows =
    tenant.companyId != null
      ? await sqlFn`
          SELECT id, questions FROM survey_form WHERE company_id = ${tenant.companyId}
        `.catch(() => [])
      : await sqlFn`
          SELECT id, questions FROM survey_form WHERE created_by = ${tenant.adminId}
        `.catch(() => []);
  return rows as { id: number; questions: unknown }[];
}

/** Only Super Admin, or an admin of the owning company / the creating admin, may edit a row. */
export function canTouchCategory(
  me: { id: unknown; company_id: unknown; role: string },
  cat: QuestionCategory,
): boolean {
  if (me.role === "super_admin") return true;
  const mine = categoryTenantOf(me);
  const cid = Number(cat.company_id);
  if (Number.isFinite(cid) && cid > 0) return mine.companyId === cid;
  return mine.companyId == null && Number(cat.created_by) === mine.adminId;
}

/** Question tags per category name across the tenant's surveys (single pass). */
export async function categoryUseCounts(
  sqlFn: NonNullable<typeof sql>,
  tenant: { companyId: number | null; adminId: number },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const f of await surveysForCategoryTenant(sqlFn, tenant)) {
    for (const q of parseQuestionsArray(f.questions) as Record<string, unknown>[]) {
      const name = String(q.category ?? "").trim().toLowerCase();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return counts;
}

/** Questions in the tenant's surveys still tagged with this category name. */
export async function countCategoryUse(
  sqlFn: NonNullable<typeof sql>,
  tenant: { companyId: number | null; adminId: number },
  name: string,
): Promise<number> {
  return (await categoryUseCounts(sqlFn, tenant)).get(name.toLowerCase()) || 0;
}

/** Rewrite one category tag across the tenant's surveys. Idempotent, so a partial
 *  rename can be retried. Answers stay keyed by question id, so no submission data moves. */
export async function retagCategoryInTenant(
  sqlFn: NonNullable<typeof sql>,
  tenant: { companyId: number | null; adminId: number },
  fromName: string,
  toName: string,
): Promise<number> {
  const fromLower = fromName.toLowerCase();
  let touched = 0;
  for (const f of await surveysForCategoryTenant(sqlFn, tenant)) {
    const list = parseQuestionsArray(f.questions) as Record<string, unknown>[];
    let changed = false;
    const next = list.map((q) => {
      if (String(q.category ?? "").trim().toLowerCase() !== fromLower) return q;
      changed = true;
      return { ...q, category: toName };
    });
    if (!changed) continue;
    await sqlFn`
      UPDATE survey_form SET questions = ${JSON.stringify(next)}::jsonb, updated_at = NOW()
      WHERE id = ${f.id}
    `.catch(() => null);
    touched += 1;
  }
  return touched;
}


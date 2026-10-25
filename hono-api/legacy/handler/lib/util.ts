/** Parse survey_form.questions whether stored as jsonb array or double-encoded string. */
export function parseQuestionsArray(raw: unknown): unknown[] {
  let qs: unknown = raw;
  if (typeof qs === "string") {
    try {
      qs = JSON.parse(qs);
    } catch {
      return [];
    }
  }
  // Some rows store a JSON string inside jsonb
  if (typeof qs === "string") {
    try {
      qs = JSON.parse(qs);
    } catch {
      return [];
    }
  }
  return Array.isArray(qs) ? qs : [];
}

/** Retry a query once — transient HTTP failure on the serverless driver. */
export async function retryOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return await run();
  }
}


/**
 * Optional LLM wrapper. Not wired — this product does not send field data
 * to an AI provider unless you add a key and call it from a route.
 */
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") || "";

export function groqConfigured(): boolean {
  return Boolean(GROQ_API_KEY);
}

export async function groqChat(prompt: string): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set");
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || "";
}

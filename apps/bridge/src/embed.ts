// Gemini gemini-embedding-001 client (768-dim). Used by memory inject for
// semantic retrieval. Small wrapper, no batching — retrieval is single-query.

const MODEL = "gemini-embedding-001";

export async function embed(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY unset");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
    }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embedding: { values: number[] } };
  return json.embedding.values;
}

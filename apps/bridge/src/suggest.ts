// /suggest — scan agent load from hive_mind and propose a new agent if load is unbalanced.
// Structural analysis only (no LLM call required for the basic signal).
// Set GEMINI_API_KEY to get LLM-enriched suggestions.

import type Database from "better-sqlite3";

const MIN_EVIDENCE = 10;

interface AgentCount {
  agent: string;
  n: number;
}

interface Suggestion {
  agent: string;
  count: number;
  avg: number;
  message: string;
}

async function enrichWithGemini(
  agent: string,
  samples: string[],
  key: string,
): Promise<string | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    const prompt =
      `Agent "${agent}" handled these recent tasks:\n${samples.join("\n")}\n\n` +
      `Are they all in the same role? If not, propose a new agent: name, one-line role, tasks to migrate. ` +
      `Reply in <=3 sentences.`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: [{ content: { parts: [{ text: string }] } }];
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function runSuggestCommand(db: Database.Database): Promise<string> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  const counts = db
    .prepare(
      `SELECT agent, COUNT(*) AS n FROM hive_mind
       WHERE created_at >= ? GROUP BY agent ORDER BY n DESC`,
    )
    .all(cutoff) as AgentCount[];

  if (!counts.length) return "No hive_mind activity in the last 7 days. Nothing to suggest.";

  const total = counts.reduce((a, b) => a + b.n, 0);
  if (total < MIN_EVIDENCE) {
    return `Only ${total} hive_mind entries in 7 days (need ${MIN_EVIDENCE}). Not enough data for suggestions.`;
  }

  const avg = total / counts.length;
  const overloaded = counts.filter((c) => c.n > avg * 2);

  if (!overloaded.length) {
    const lines = counts.map((c) => `• ${c.agent}: ${c.n} tasks`).join("\n");
    return `Agent load is balanced (avg ${Math.round(avg)} tasks/agent):\n${lines}`;
  }

  const suggestions: Suggestion[] = overloaded.map((c) => ({
    agent: c.agent,
    count: c.n,
    avg: Math.round(avg),
    message: `${c.agent} handled ${c.n} tasks vs avg ${Math.round(avg)} — consider splitting`,
  }));

  const parts: string[] = ["*Agent Load Analysis (7d)*\n"];

  for (const s of suggestions) {
    parts.push(
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `*OVERLOADED: ${s.agent.toUpperCase()}*\n` +
        `${s.count} tasks vs avg ${s.avg}\n`,
    );

    // Try to enrich with Gemini if key is available.
    const key = process.env.GEMINI_API_KEY;
    if (key) {
      const samples = (
        db
          .prepare(
            `SELECT prompt FROM hive_mind WHERE agent = ? AND created_at >= ? LIMIT 15`,
          )
          .all(s.agent, cutoff) as Array<{ prompt: string }>
      ).map((r) => `- ${r.prompt.slice(0, 80)}`);

      const enriched = await enrichWithGemini(s.agent, samples, key);
      if (enriched) {
        parts.push(`*Gemini analysis:* ${enriched}\n`);
      }
    }

    parts.push(`[Run /standup to see current workload]`);
  }

  return parts.join("\n");
}

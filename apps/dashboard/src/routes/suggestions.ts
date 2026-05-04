// V3 transcript ch.11 — overburdened-agent detector.
// GET /api/suggestions?period=7d  →  { current_load, recommendation? }
//
// Reads hive_mind, ranks agents by 7-day task count, asks Gemini Flash whether
// the busiest agent's tasks span multiple roles. If yes (confidence > 0.7),
// proposes a split with name + sample migrating tasks.

import { Hono } from "hono";
import type Database from "better-sqlite3";

const MODEL = "gemini-2.5-flash";
const MIN_EVIDENCE = 10;
const MIN_CONFIDENCE = 0.7;
const VALID_PERIODS = new Set(["7d", "30d"]);

type LoadRow = { agent: string; count: number };
type Recommendation = {
  current_agent: string;
  new_agent_name: string;
  new_agent_role: string;
  rationale: string;
  tasks_to_migrate: string[];
  confidence: number;
};

export default function suggestionsRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/", async (c) => {
    const period = c.req.query("period") ?? "7d";
    if (!VALID_PERIODS.has(period)) {
      return c.json({ error: "period must be 7d or 30d" }, 400);
    }
    const days = Number(period.replace("d", ""));
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

    const load = db
      .prepare(
        `SELECT agent, COUNT(*) AS count
         FROM hive_mind
         WHERE created_at >= ?
         GROUP BY agent
         ORDER BY count DESC`,
      )
      .all(cutoff) as LoadRow[];

    if (load.length === 0 || load[0].count < MIN_EVIDENCE) {
      return c.json({
        period,
        current_load: load,
        recommendation: null,
        reason: "insufficient evidence",
      });
    }

    const busiest = load[0];
    const tasks = db
      .prepare(
        `SELECT prompt FROM hive_mind
         WHERE agent = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all(busiest.agent, cutoff) as { prompt: string }[];

    const recommendation = await analyze(busiest.agent, tasks.map((t) => t.prompt));

    return c.json({
      period,
      current_load: load,
      recommendation:
        recommendation && recommendation.confidence >= MIN_CONFIDENCE
          ? recommendation
          : null,
    });
  });

  return app;
}

async function analyze(
  agent: string,
  prompts: string[],
): Promise<Recommendation | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("[suggestions] GEMINI_API_KEY unset; skipping LLM analysis");
    return null;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const sys = `You analyze whether an AI agent has accidentally absorbed multiple roles.

Given ${prompts.length} recent tasks from the "${agent}" agent, decide:
1. Are these tasks all in the same domain? (yes → no recommendation)
2. If split, what's the cleanest second role?

Output strict JSON only:
{
  "current_agent": "${agent}",
  "new_agent_name": "<lowercase_snake_case>",
  "new_agent_role": "<one-line>",
  "rationale": "<one sentence: why split>",
  "tasks_to_migrate": ["<verbatim task 1>", "<verbatim task 2>", "<verbatim task 3>"],
  "confidence": <0.0-1.0>
}

If no split is warranted, return: {"confidence": 0.0}`;

  const taskList = prompts.map((p, i) => `${i + 1}. ${p.slice(0, 200)}`).join("\n");

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${sys}\n\nTASKS:\n${taskList}` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    console.warn(`[suggestions] gemini ${res.status}`);
    return null;
  }
  const json = (await res.json()) as {
    candidates?: [{ content: { parts: [{ text: string }] } }];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.confidence !== "number" || parsed.confidence === 0) return null;
    return parsed as Recommendation;
  } catch {
    return null;
  }
}

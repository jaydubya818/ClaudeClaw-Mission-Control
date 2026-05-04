// Auto-assign: cheap Gemini 2.5 Flash call picks the best agent for a task.
// Returns one of {main, meta, comms, content, ops, research}.

const MODEL = "gemini-2.5-flash";

const SYSTEM = `You are a task router. Given a task description, reply with exactly one of:
main, meta, comms, content, ops, research

Guide:
- meta = Meta/Facebook/Instagram ads, ROAS, ad creative refreshes, paid acquisition
- comms = email, DMs, inbox triage, Slack, Telegram posting
- content = YouTube scripts, thumbnails, organic posts, creative writing
- ops = finances, vendors, expenses, business operations (read-only on money)
- research = web research, analysis, memos, deep dives
- main = fallback when unclear; delegates further

Reply with the single word only, lowercase.`;

export async function pickAgent(task: { title: string; description?: string }): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY unset");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const prompt = `${SYSTEM}\n\nTASK: ${task.title}\n${task.description ?? ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    }),
  });
  if (!res.ok) throw new Error(`assign ${res.status}`);
  const json = (await res.json()) as {
    candidates?: [{ content: { parts: [{ text: string }] } }];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() ?? "main";
  const valid = ["main", "meta", "comms", "content", "ops", "research"];
  return valid.includes(raw) ? raw : "main";
}

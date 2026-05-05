// Auto-assign: cheap Gemini 2.5 Flash call picks the best agent for a task.
// Returns one of {main, meta, comms, content, ops, research}.

const MODEL = "gemini-2.5-flash";

// Few-shot prompt — biases the classifier toward specialists, away from
// the "main" fallback which was over-triggering on obvious specialist tasks.
const SYSTEM = `You are a task router. Reply with EXACTLY one lowercase word from:
main · meta · comms · content · ops · research

Match by intent, not surface keywords. Pick the SPECIALIST when the task
clearly fits one. Use "main" only if no specialist fits or the task is
purely conversational triage.

Specialist guide:
- meta:     Meta/Facebook/Instagram ads, ROAS, ad spend, ad creative
- comms:    email, DMs, replies, inbox triage, Slack/Telegram posting
- content:  YouTube scripts, thumbnails, blog posts, social posts, creative writing, video ideas
- ops:      finances, vendors, invoices, scheduling, calendar, billing
- research: web research, deep dives, analysis, market reports, learning a topic, "research X", "what is X"
- main:     ambiguous, conversational, or pure delegation

Examples:
- "research netflix culture" → research
- "draft an email to dan" → comms
- "make a thumbnail for the V3 video" → content
- "what did ops do today" → main
- "pull yesterday's roas" → meta
- "categorize last week's expenses" → ops
- "summarize the new openai paper" → research
- "compare X to Y" → research
- "write a tweet about Z" → content
- "reply to the linkedin DM" → comms

Reply with the single specialist word only — lowercase, no punctuation.`;

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

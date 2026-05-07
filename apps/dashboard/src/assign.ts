// Auto-assign: deterministic regex pre-classifier → Gemini 2.5 Flash fallback.
// Returns one of {main, meta, comms, content, ops, research, sales}.
//
// The regex layer catches the obvious cases ("research X", "draft email",
// "thumbnail for", "ROAS for campaign", etc.) where Gemini was over-routing
// to "main". LLM still handles the ambiguous middle ground.

const MODEL = "gemini-2.5-flash";

// Pre-classifier: keyword/pattern → agent. First match wins.
// Order matters — more specific patterns first.
const RULES: Array<{ pattern: RegExp; agent: string; reason: string }> = [
  // Meta ads — explicit channel + ad terminology
  { pattern: /\b(meta|facebook|instagram|fb)\s+ads?\b/i, agent: "meta", reason: "explicit-ads-platform" },
  { pattern: /\broas\b|\bcpc\b|\bctr\b|\bcpm\b|\bad\s*spend\b|\bad\s*creative\b/i, agent: "meta", reason: "ads-jargon" },
  { pattern: /^pull\s+(today|yesterday|weekly|the)\s+(roas|ad)/i, agent: "meta", reason: "pull-roas" },

  // Research — "research X", "what is X", "deep dive"
  { pattern: /^research\b/i, agent: "research", reason: "starts-with-research" },
  { pattern: /\b(deep\s*dive|dossier|literature\s+review|market\s+analysis|competitive\s+analysis)\b/i, agent: "research", reason: "research-jargon" },
  { pattern: /^(what\s+is|how\s+does|tell\s+me\s+about|summarize)\s+/i, agent: "research", reason: "knowledge-question" },

  // Comms — drafting/sending messages, inbox
  { pattern: /^(draft|reply|respond|forward|send)\s+(an?\s+)?(email|message|dm|note)/i, agent: "comms", reason: "draft-message" },
  { pattern: /\b(inbox|email|gmail|outlook|slack)\b.*\b(triage|reply|draft|respond)\b/i, agent: "comms", reason: "inbox-triage" },
  { pattern: /\b(linkedin|telegram)\s+(message|reply|dm|post)\b/i, agent: "comms", reason: "messaging-platform" },

  // Content — creative output
  { pattern: /\b(thumbnail|youtube\s+script|video\s+script|hook|cold\s+open)\b/i, agent: "content", reason: "creative-asset" },
  { pattern: /\b(blog|tweet|carousel|post)\s+(about|for|on)\b/i, agent: "content", reason: "creative-publish" },
  { pattern: /^(write|draft)\s+(a\s+)?(blog|post|tweet|script)/i, agent: "content", reason: "creative-write" },

  // Ops — finances, calendar, vendors
  { pattern: /\b(invoices?|expenses?|stripe|billing|vendors?|subscriptions?)\b/i, agent: "ops", reason: "finance-vendor" },
  { pattern: /\bcategoriz[ei].*\b(expense|invoice|charge|transaction)/i, agent: "ops", reason: "finance-categorize" },
  { pattern: /\b(schedule|book|cancel|reschedule)\s+(a\s+)?(meeting|call)\b/i, agent: "ops", reason: "calendar-action" },
  { pattern: /\b(quicken|quickbooks)\b/i, agent: "ops", reason: "accounting-tool" },

  // Sales — outreach
  { pattern: /\b(outreach|cold\s*outreach|lead\s+(qualif|score)|sales\s+follow.?up)\b/i, agent: "sales", reason: "sales-pipeline" },
];

function preClassify(title: string, description?: string): { agent: string; reason: string } | null {
  const text = `${title} ${description ?? ""}`.trim();
  if (!text) return null;
  for (const r of RULES) {
    if (r.pattern.test(text)) return { agent: r.agent, reason: r.reason };
  }
  return null;
}

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
  // Layer 1: deterministic pre-classifier
  const pre = preClassify(task.title, task.description);
  if (pre) {
    console.log(`[assign] pre-classified "${task.title.slice(0, 60)}" → ${pre.agent} (${pre.reason})`);
    return pre.agent;
  }

  // Layer 2: Gemini Flash
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn("[assign] GEMINI_API_KEY unset; defaulting to main");
    return "main";
  }
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
  if (!res.ok) {
    console.warn(`[assign] gemini ${res.status}; defaulting to main`);
    return "main";
  }
  const json = (await res.json()) as {
    candidates?: [{ content: { parts: [{ text: string }] } }];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "main";
  const valid = ["main", "meta", "comms", "content", "ops", "research", "sales"];
  return valid.includes(raw) ? raw : "main";
}

// Exported for unit/smoke testing.
export const _preClassify = preClassify;

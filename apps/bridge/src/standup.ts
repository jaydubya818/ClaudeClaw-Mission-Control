// Standup and discuss commands — TypeScript implementation.
// /standup [@agent ...]   → 24h hive_mind status per agent; Main consolidates.
// /discuss <topic>        → each agent weighs in; Main consolidates.
//
// Agents run in parallel (no cross-talk until consolidation).

import type Database from "better-sqlite3";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";

export const ALL_AGENTS = ["main", "comms", "content", "ops", "research"] as const;
export type AgentName = (typeof ALL_AGENTS)[number];

export function parseStandupCommand(
  text: string,
): { cmd: "standup" | "discuss"; agents: AgentName[]; topic: string } | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;

  const standupMatch = t.match(/^\/standup(?:\s+(.+))?$/i);
  if (standupMatch) {
    const rest = standupMatch[1] ?? "";
    const tagged = rest
      .split(/\s+/)
      .map((s) => s.replace(/^@/, "").toLowerCase())
      .filter((s): s is AgentName => s !== "main" && ALL_AGENTS.includes(s as AgentName));
    return {
      cmd: "standup",
      agents: tagged.length ? tagged : ALL_AGENTS.filter((a) => a !== "main"),
      topic: "",
    };
  }

  const discussMatch = t.match(/^\/discuss\s+(.+)$/i);
  if (discussMatch) {
    return {
      cmd: "discuss",
      agents: ALL_AGENTS.filter((a) => a !== "main"),
      topic: discussMatch[1].trim(),
    };
  }

  return null;
}

function fetch24h(
  db: Database.Database,
  agent: string,
): Array<{ prompt: string; reply: string }> {
  const cutoff = Math.floor(Date.now() / 1000) - 86400;
  return db
    .prepare(
      `SELECT prompt, reply FROM hive_mind
       WHERE agent = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 50`,
    )
    .all(agent, cutoff) as Array<{ prompt: string; reply: string }>;
}

function standupPrompt(
  agent: string,
  entries: Array<{ prompt: string; reply: string }>,
): string {
  if (!entries.length) {
    return (
      `You are the ${agent} agent. You have nothing in hive_mind for the last 24h. ` +
      `Reply with exactly: 'Nothing to report.'`
    );
  }
  const bullets = entries
    .slice(0, 20)
    .map((e) => `- ${e.prompt.slice(0, 80)} → ${e.reply.slice(0, 120)}`)
    .join("\n");
  return (
    `You are the ${agent} agent. Give a 3-bullet standup of your last 24h. Terse, no preamble.\n` +
    `Format:\nWRAPPED: <one line>\nQUEUED: <one line>\nBLOCKED: <one line or 'none'>\n\n` +
    `Hive_mind activity:\n${bullets}`
  );
}

function discussPrompt(agent: string, topic: string): string {
  return (
    `You are the ${agent} agent. Topic: ${topic}\n\n` +
    `Give your unique angle in 2–3 sentences. Stay in your lane (${agent}'s expertise). ` +
    `Don't summarize others — you can't see them.`
  );
}

function consolidatePrompt(replies: Record<string, string>, topic: string): string {
  const formatted = Object.entries(replies)
    .map(([a, r]) => `## ${a}\n${r}`)
    .join("\n\n");
  if (topic) {
    return (
      `You are Main. Five agents weighed in on: ${topic}\n\n${formatted}\n\n` +
      `Consolidate in <=4 sentences. Surface the strongest disagreement. ` +
      `State your call. No preamble.`
    );
  }
  return (
    `You are Main. Standup replies:\n\n${formatted}\n\n` +
    `Synthesize: who's blocked, who needs attention, what should Jay do today. <=4 sentences.`
  );
}

async function runQuery(agentCwd: string, prompt: string): Promise<string> {
  let reply = "";
  const result = query({ prompt, options: { cwd: agentCwd } });
  for await (const ev of result) {
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "text") reply += block.text;
      }
    }
  }
  return reply.trim() || "(no reply)";
}

export async function runStandupCommand(
  db: Database.Database,
  agentRoot: string,
  agents: AgentName[],
  topic: string,
  cmd: "standup" | "discuss",
): Promise<string> {
  // Run specialist agents in parallel — no cross-talk until Main consolidates.
  const replyEntries = await Promise.all(
    agents.map(async (agent) => {
      const prompt =
        cmd === "standup"
          ? standupPrompt(agent, fetch24h(db, agent))
          : discussPrompt(agent, topic);
      const reply = await runQuery(resolve(agentRoot, agent), prompt);
      return [agent, reply] as const;
    }),
  );

  const replies = Object.fromEntries(replyEntries);

  // Main consolidates all replies.
  const mainPrompt = consolidatePrompt(replies, topic);
  const mainReply = await runQuery(resolve(agentRoot, "main"), mainPrompt);

  const sections = replyEntries.map(([agent, reply]) => `*${agent}:* ${reply}`).join("\n\n");
  return `${sections}\n\n---\n*Main:* ${mainReply}`;
}

// Task runner — executes Mission Control tasks against the Claude Agent SDK.
// Triggered when dashboard sets task.status = 'live' (POST /api/tasks/:id/run).
//
// Reads the task, loads the assigned agent's CLAUDE.md, runs the SDK query,
// writes result + cost + tokens back to the tasks table, sets status='done'
// (or 'failed' on error).

import type Database from "better-sqlite3";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";

const REPO_ROOT = resolve(process.cwd(), "../../");
const AGENT_ROOT = resolve(REPO_ROOT, "agents");
const TURN_TIMEOUT_MS = 5 * 60 * 1000;          // 5 minutes hard cap per task
const MAX_RESULT_CHARS = 8000;                  // truncate for sane UI rendering

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  agent: string | null;
  status: string;
};

export async function runTask(
  db: Database.Database,
  taskId: number,
  notify?: (msg: string) => Promise<void>,
): Promise<{ ok: boolean; reason?: string }> {
  const t = db.prepare(`SELECT id, title, description, agent, status FROM tasks WHERE id = ?`).get(taskId) as
    | TaskRow | undefined;
  if (!t) return { ok: false, reason: "task not found" };
  if (!t.agent) return { ok: false, reason: "task has no agent — auto-assign first" };
  if (t.status === "live") return { ok: false, reason: "task already running" };

  // Mark live + record start.
  const now = () => Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE tasks SET status='live', started_at=?, error=NULL, updated_at=? WHERE id=?`,
  ).run(now(), now(), taskId);

  let reply = "";
  let costUsd = 0;
  let inTok = 0;
  let outTok = 0;
  const prompt = t.description ? `${t.title}\n\n${t.description}` : t.title;

  try {
    let system = `You are the ${t.agent} agent.`;
    try {
      system = await readFile(resolve(AGENT_ROOT, t.agent, "CLAUDE.md"), "utf8");
    } catch {
      /* fallback */
    }

    const result = query({
      prompt,
      options: {
        cwd: resolve(AGENT_ROOT, t.agent),
        systemPrompt: system,
      },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("task timeout")), TURN_TIMEOUT_MS),
    );

    await Promise.race([
      (async () => {
        for await (const ev of result) {
          if (ev.type === "assistant" && ev.message?.content) {
            for (const block of ev.message.content) {
              if (block.type === "text") reply += block.text;
            }
          }
          if (ev.type === "result") {
            costUsd = ev.total_cost_usd ?? 0;
            inTok = ev.usage?.input_tokens ?? 0;
            outTok = ev.usage?.output_tokens ?? 0;
          }
        }
      })(),
      timeout,
    ]);

    if (!reply.trim()) reply = "(agent returned no text)";
    const trimmed = reply.length > MAX_RESULT_CHARS
      ? reply.slice(0, MAX_RESULT_CHARS) + "\n…[truncated]"
      : reply;

    db.prepare(
      `UPDATE tasks SET status='done', result=?, cost_usd=?, tokens=?,
                        finished_at=?, updated_at=?
        WHERE id=?`,
    ).run(trimmed, costUsd, inTok + outTok, now(), now(), taskId);

    // Also write to hive_mind so /standup and audit trails see it.
    try {
      db.prepare(
        `INSERT INTO hive_mind (agent, prompt, reply, created_at)
         VALUES (?, ?, ?, strftime('%s','now'))`,
      ).run(t.agent, `[task #${t.id}] ${prompt.slice(0, 200)}`, trimmed.slice(0, 4000));
    } catch { /* non-fatal */ }
    // And write to usage table.
    try {
      db.prepare(
        `INSERT INTO usage (agent, ts, input_tok, output_tok, cost_usd)
         VALUES (?, strftime('%s','now'), ?, ?, ?)`,
      ).run(t.agent, inTok, outTok, costUsd);
    } catch { /* non-fatal */ }

    if (notify) await notify(`✓ #${t.id} (${t.agent}) done · $${costUsd.toFixed(4)} · ${inTok + outTok}t\n\n${trimmed.slice(0, 1500)}`);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    db.prepare(
      `UPDATE tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
    ).run(msg.slice(0, 500), now(), now(), taskId);
    if (notify) await notify(`✗ #${t.id} (${t.agent}) failed · ${msg.slice(0, 200)}`);
    return { ok: false, reason: msg };
  }
}

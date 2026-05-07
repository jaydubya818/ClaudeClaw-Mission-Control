// Task runner — executes Mission Control tasks against the `claude` CLI.
// Lives in the dashboard process (not the bridge) so it works regardless of
// whether the bridge service is running. Same subprocess pattern as
// apps/warroom/standup_runner.py.

import type Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "../../");
const AGENT_ROOT = resolve(REPO_ROOT, "agents");
const CLAUDE_CMD = process.env.CLAUDE_CMD ?? "claude";
// Default 10min — task #8 ("netflix deep dive") came within 6s of the old 5min cap.
// Override per-deployment via TASK_TIMEOUT_MS=<ms> in .env.
const TURN_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS ?? 10 * 60 * 1000);
const MAX_RESULT_CHARS = 8000;

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  agent: string | null;
  status: string;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function runTask(
  db: Database.Database,
  taskId: number,
): Promise<{ ok: boolean; reason?: string; result?: string }> {
  const t = db
    .prepare(`SELECT id, title, description, agent, status FROM tasks WHERE id=?`)
    .get(taskId) as TaskRow | undefined;
  if (!t) return { ok: false, reason: "task not found" };
  if (!t.agent) return { ok: false, reason: "task has no agent" };
  if (t.status === "live") return { ok: false, reason: "task already running" };

  // Mark live.
  db.prepare(
    `UPDATE tasks SET status='live', started_at=?, error=NULL, result=NULL, updated_at=? WHERE id=?`,
  ).run(nowSec(), nowSec(), taskId);

  const prompt = t.description ? `${t.title}\n\n${t.description}` : t.title;
  const agentDir = resolve(AGENT_ROOT, t.agent);

  const result = await invokeClaude(agentDir, prompt);

  if (!result.ok) {
    db.prepare(
      `UPDATE tasks SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?`,
    ).run(result.reason!.slice(0, 500), nowSec(), nowSec(), taskId);
    return result;
  }

  const trimmed = result.text.length > MAX_RESULT_CHARS
    ? result.text.slice(0, MAX_RESULT_CHARS) + "\n…[truncated]"
    : result.text;

  db.prepare(
    `UPDATE tasks SET status='done', result=?, cost_usd=?, tokens=?,
                      finished_at=?, updated_at=?
      WHERE id=?`,
  ).run(trimmed, result.costUsd, result.tokens, nowSec(), nowSec(), taskId);

  // Reflect in hive_mind + usage so /standup and /api/usage see it.
  try {
    db.prepare(
      `INSERT INTO hive_mind (agent, prompt, reply, created_at)
       VALUES (?, ?, ?, strftime('%s','now'))`,
    ).run(t.agent, `[task #${t.id}] ${prompt.slice(0, 200)}`, trimmed.slice(0, 4000));
  } catch { /* non-fatal */ }
  try {
    db.prepare(
      `INSERT INTO usage (agent, ts, input_tok, output_tok, cost_usd)
       VALUES (?, strftime('%s','now'), 0, ?, ?)`,
    ).run(t.agent, result.tokens, result.costUsd);
  } catch { /* non-fatal */ }

  return { ok: true, result: trimmed };
}

async function invokeClaude(
  cwd: string,
  prompt: string,
): Promise<{ ok: true; text: string; tokens: number; costUsd: number } | { ok: false; reason: string }> {
  return new Promise((resolveFn) => {
    const proc = spawn(CLAUDE_CMD, ["-p", prompt], {
      cwd,
      env: { ...process.env, CLAUDE_NONINTERACTIVE: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolveFn({ ok: false, reason: `task timeout after ${TURN_TIMEOUT_MS / 1000}s` });
    }, TURN_TIMEOUT_MS);

    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolveFn({ ok: false, reason: `failed to spawn ${CLAUDE_CMD}: ${e.message}` });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolveFn({ ok: false, reason: `claude exited ${code}: ${stderr.slice(0, 300)}` });
        return;
      }
      const text = stdout.trim();
      if (!text) {
        resolveFn({ ok: false, reason: "claude returned empty output" });
        return;
      }
      // Approx token count — `claude -p` doesn't print usage. Use char-based estimate.
      const tokens = Math.ceil(text.length / 4);
      resolveFn({ ok: true, text, tokens, costUsd: 0 });
    });
  });
}

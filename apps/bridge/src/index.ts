// ClaudeClaw — SDK ↔ Telegram bridge (Phase 1–3).
// The entire "framework" is this file + queue/classifier/exfil-guard.
// Everything else in the repo is optional, removable, swappable.

import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import Database from "better-sqlite3";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PerChatQueue } from "./queue.js";
import { routeMessage, type AgentName } from "./classifier.js";
import { scan, redact } from "./exfil-guard.js";
import { embed } from "./embed.js";
import { buildInjectBlock } from "../../../memory/inject.js";
import { parseStandupCommand, runStandupCommand } from "./standup.js";
import { runSuggestCommand } from "./suggest.js";
import { rotateAuditIfLarge } from "./log-rotation.js";
import { runInsightsCommand } from "./insights-cmd.js";
import { runTask } from "./task-runner.js";

// --- config ---
const TOKEN = must("TELEGRAM_BOT_TOKEN");
const ALLOWED = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const DB_PATH = process.env.DB_PATH ?? "./store/claudeclaw.db";
const AGENT_ROOT = resolve(process.cwd(), "../../agents");
const AUDIT_LOG = resolve(process.cwd(), "../../security/audit.log");

// --- boot ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
const bot = new TelegramBot(TOKEN, { polling: true });
const fifo = new PerChatQueue();

log("bridge up", { allowed: [...ALLOWED] });

// Internal enqueue endpoint for War Room sub-agent spawning.
// Listens on 127.0.0.1 only; no auth beyond loopback.
import { createServer } from "node:http";
const INTERNAL_PORT = Number(process.env.BRIDGE_INTERNAL_PORT ?? 3142);
createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;

  // Mission Control task execution: POST /run-task { task_id, notify_chat_id? }
  if (req.method === "POST" && req.url === "/run-task") {
    try {
      const { task_id, notify_chat_id } = JSON.parse(body);
      if (typeof task_id !== "number") {
        res.writeHead(400).end(JSON.stringify({ error: "task_id required" }));
        return;
      }
      // Fire and forget — runTask updates the tasks table directly.
      runTask(db, task_id, notify_chat_id ? async (msg) => {
        try { await bot.sendMessage(notify_chat_id, msg); } catch { /* ignore */ }
      } : undefined).then(r => {
        log("task.run", { task_id, ok: r.ok, reason: r.reason });
      }).catch(e => log("task.run.error", { task_id, err: String(e) }));
      res.writeHead(202).end(JSON.stringify({ accepted: true, task_id }));
    } catch (e) {
      res.writeHead(400).end(String(e));
    }
    return;
  }

  // Original Telegram-style enqueue
  if (req.method === "POST" && req.url === "/enqueue") {
    try {
      const { chatId, text } = JSON.parse(body);
      if (!ALLOWED.has(String(chatId))) {
        res.writeHead(403).end("not allowed");
        return;
      }
      fifo.enqueue(String(chatId), () => handle(String(chatId), text)).catch(() => {});
      res.writeHead(202).end("queued");
    } catch (e) {
      res.writeHead(400).end(String(e));
    }
    return;
  }

  res.writeHead(404).end();
}).listen(INTERNAL_PORT, "127.0.0.1", () =>
  log("bridge.internal up", { port: INTERNAL_PORT }),
);

bot.on("message", (msg) => {
  const chatId = String(msg.chat.id);
  if (!ALLOWED.has(chatId)) {
    log("blocked", { chatId, text: msg.text?.slice(0, 40) });
    return; // silent
  }
  const text = msg.text ?? "";
  fifo.enqueue(chatId, () => handle(chatId, text)).catch((err) => {
    log("handle.error", { err: String(err) });
    bot.sendMessage(chatId, `⚠️ ${String(err).slice(0, 200)}`).catch(() => {});
  });
});

// --- main handler ---
async function handle(chatId: string, text: string) {
  // slash commands
  if (text.startsWith("/")) {
    const handled = await handleSlash(chatId, text);
    if (handled) return;
  }

  if (killed) {
    await bot.sendMessage(chatId, "🛑 halted. /resume to re-enable.");
    return;
  }

  const { agent, stripped } = routeMessage(text);
  log("msg", { chatId, agent, len: stripped.length });

  const baseSystem = await loadAgentSystem(agent);
  const injectBlock = await buildInjectBlock({
    dbPath: DB_PATH,
    agent,
    firstMessage: stripped,
    embed,
    obsidianRoot: process.env.OBSIDIAN_ROOT,
    obsidianFolder: `agents/${agent}`,
  }).catch((e) => {
    log("inject.error", { err: String(e) });
    return "";
  });
  const systemPrompt = injectBlock ? `${injectBlock}\n\n---\n\n${baseSystem}` : baseSystem;
  let reply = "";
  let costUsd = 0;
  let tokens = 0;

  const result = query({
    prompt: stripped,
    options: {
      // path to this agent's CLAUDE.md + tools — the SDK picks it up from cwd
      cwd: resolve(AGENT_ROOT, agent),
      systemPrompt,
      // Use subscription if ANTHROPIC_API_KEY unset; SDK handles it.
    },
  });

  for await (const ev of result) {
    if (ev.type === "assistant" && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === "text") reply += block.text;
      }
    }
    if (ev.type === "result") {
      costUsd = ev.total_cost_usd ?? 0;
      const inTok = ev.usage?.input_tokens ?? 0;
      const outTok = ev.usage?.output_tokens ?? 0;
      tokens = inTok + outTok;
      writeHive(agent, stripped, reply);
      writeUsage(agent, inTok, outTok, costUsd);   // A1
    }
  }

  // Guard outbound before sending.
  const hits = scan(reply);
  if (hits.length) {
    log("exfil.block", { hits });
    reply = redact(reply) + `\n\n🛡️ ${hits.length} secret(s) redacted.`;
  }

  const footer = `\n\n_[${agent} · $${costUsd.toFixed(4)} · ${tokens}t]_`;
  await bot.sendMessage(chatId, reply + footer, { parse_mode: "Markdown" });
}

// --- slash commands ---
const KILL_PHRASE = process.env.KILL_PHRASE ?? "seven kingdoms fall";
// Prefer the public tunnel URL when set (for /dashboard from phone).
const DASHBOARD_URL =
  process.env.DASHBOARD_PUBLIC_URL ??
  process.env.DASHBOARD_URL ??
  "http://localhost:3141";
let killed = false;

async function handleSlash(chatId: string, text: string): Promise<boolean> {
  const cmd = text.trim().split(/\s+/, 1)[0].toLowerCase();
  switch (cmd) {
    case "/whoami":
      await bot.sendMessage(chatId, `chatId: \`${chatId}\``, { parse_mode: "Markdown" });
      return true;
    case "/dashboard":
      await bot.sendMessage(chatId, DASHBOARD_URL);
      return true;
    case "/kill":
      killed = true;
      log("kill", { chatId });
      await bot.sendMessage(chatId, "🛑 agents halted. /resume to re-enable.");
      return true;
    case "/resume":
      killed = false;
      await bot.sendMessage(chatId, "✅ resumed.");
      return true;
    case "/status": {
      const counts = db
        .prepare(`SELECT agent, COUNT(*) AS n FROM hive_mind GROUP BY agent`)
        .all() as { agent: string; n: number }[];
      const body = counts.map((c) => `• ${c.agent}: ${c.n} turns`).join("\n") || "no activity";
      await bot.sendMessage(chatId, `*Hive mind*\n${body}`, { parse_mode: "Markdown" });
      return true;
    }
    case "/standup":
    case "/discuss": {
      const parsed = parseStandupCommand(text);
      if (!parsed) {
        await bot.sendMessage(chatId, "Usage: `/standup [@agent ...]` or `/discuss <topic>`", {
          parse_mode: "Markdown",
        });
        return true;
      }
      await bot.sendMessage(chatId, "⏳ Gathering reports…");
      try {
        const result = await runStandupCommand(
          db,
          AGENT_ROOT,
          parsed.agents,
          parsed.topic,
          parsed.cmd,
        );
        await bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ ${String(e).slice(0, 200)}`);
      }
      return true;
    }
    case "/suggest": {
      await bot.sendMessage(chatId, "⏳ Scanning agent load…");
      try {
        const result = await runSuggestCommand(db);
        await bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ ${String(e).slice(0, 200)}`);
      }
      return true;
    }
    case "/insights": {
      // A8 — surface higher-order insights from memories table.
      const period = (text.split(/\s+/)[1] ?? "7d").trim();
      await bot.sendMessage(chatId, `⏳ Generating insights (${period})…`);
      try {
        const result = await runInsightsCommand(period);
        await bot.sendMessage(chatId, result, { parse_mode: "Markdown" });
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ ${String(e).slice(0, 200)}`);
      }
      return true;
    }
    case "/meeting": {
      // B1 — Daily.co meeting room creation.
      const dashboardBase =
        process.env.DASHBOARD_INTERNAL_URL ?? "http://localhost:3141";
      const agent = (text.split(/\s+/)[1] ?? "main").trim().toLowerCase();
      try {
        const res = await fetch(`${dashboardBase}/api/meeting/create`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent }),
        });
        if (!res.ok) {
          const t = await res.text();
          await bot.sendMessage(chatId, `⚠️ ${res.status}: ${t.slice(0, 200)}`);
          return true;
        }
        const json = (await res.json()) as { url: string; room_name: string; expires_at: number };
        const expIso = new Date(json.expires_at * 1000).toISOString();
        await bot.sendMessage(
          chatId,
          `🎙 Meeting ready (${agent})\n${json.url}\n\nExpires: ${expIso}`,
        );
      } catch (e) {
        await bot.sendMessage(chatId, `⚠️ ${String(e).slice(0, 200)}`);
      }
      return true;
    }
    case "/help": {
      const help = [
        "*ClaudeClaw Commands*",
        "/whoami — show your chat ID",
        "/status — hive mind turn counts",
        "/standup [@agent ...] — 24h agent standup",
        "/discuss <topic> — team discussion on a topic",
        "/suggest — scan for overloaded agents",
        "/insights [7d|30d|90d] — higher-order insights from memories",
        "/meeting [agent] — create a Daily.co video meeting (B1)",
        "/dashboard — get dashboard URL",
        "/kill — halt all agents",
        "/resume — re-enable agents",
      ].join("\n");
      await bot.sendMessage(chatId, help, { parse_mode: "Markdown" });
      return true;
    }
  }
  // Kill phrase in natural text halts all agents.
  if (text.toLowerCase().includes(KILL_PHRASE)) {
    killed = true;
    log("kill.phrase", { chatId });
    await bot.sendMessage(chatId, "🛑 kill phrase recognized. agents halted.");
    return true;
  }
  return false;
}

// --- helpers ---
async function loadAgentSystem(agent: AgentName): Promise<string> {
  const path = resolve(AGENT_ROOT, agent, "CLAUDE.md");
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path, "utf8");
  } catch {
    return `You are the ${agent} agent.`;
  }
}

function writeHive(agent: AgentName, prompt: string, reply: string) {
  db.prepare(
    `INSERT INTO hive_mind (agent, prompt, reply, created_at)
     VALUES (?, ?, ?, strftime('%s', 'now'))`,
  ).run(agent, prompt.slice(0, 2000), reply.slice(0, 4000));
}

// A1 — write per-turn usage so dashboard /api/usage reflects real cost.
function writeUsage(agent: AgentName, inTok: number, outTok: number, costUsd: number) {
  try {
    db.prepare(
      `INSERT INTO usage (agent, ts, input_tok, output_tok, cost_usd)
       VALUES (?, strftime('%s', 'now'), ?, ?, ?)`,
    ).run(agent, inTok, outTok, costUsd);
  } catch (e) {
    // Schema may not have usage table on older installs — log and continue.
    log("usage.write.error", { err: String(e).slice(0, 120) });
  }
}

function must(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
}

function log(event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: Date.now(), event, ...data });
  console.log(line);
  appendFile(AUDIT_LOG, line + "\n").catch(() => {});
}

// C3 — rotate audit.log when it grows past 10MB; runs every 6h.
const AUDIT_ROTATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  rotateAuditIfLarge(AUDIT_LOG, 10 * 1024 * 1024, 6).catch((e) =>
    log("audit.rotate.error", { err: String(e) }),
  );
}, AUDIT_ROTATE_INTERVAL_MS);
// Also run once at boot.
rotateAuditIfLarge(AUDIT_LOG, 10 * 1024 * 1024, 6).catch(() => {});

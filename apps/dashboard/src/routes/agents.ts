import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "yaml";

const AGENTS = ["main", "meta", "comms", "content", "ops", "research"] as const;

const AGENTS_ROOT = resolve(process.cwd(), "../../agents");
const RUNTIME_STATE_FILE = resolve(process.cwd(), "../../store/agent-runtime.json");

type RuntimeMap = Record<string, { status: "running" | "stopped"; today_turns: number }>;

function readRuntime(): RuntimeMap {
  if (!existsSync(RUNTIME_STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(RUNTIME_STATE_FILE, "utf8")) as RuntimeMap;
  } catch {
    return {};
  }
}
function writeRuntime(m: RuntimeMap): void {
  const dir = resolve(RUNTIME_STATE_FILE, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(m, null, 2));
}

function listAgentDirs(): string[] {
  if (!existsSync(AGENTS_ROOT)) return [...AGENTS];
  const dirs = readdirSync(AGENTS_ROOT)
    .filter((d) => !d.startsWith("_") && !d.startsWith("."))
    .filter((d) => {
      try { return statSync(join(AGENTS_ROOT, d)).isDirectory(); } catch { return false; }
    });
  return dirs.length ? dirs : [...AGENTS];
}

export default function agentsRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const runtime = readRuntime();
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const list = listAgentDirs().map((name) => {
      const total = db
        .prepare(`SELECT COUNT(*) AS n FROM hive_mind WHERE agent = ?`)
        .get(name) as { n: number };
      const today = db
        .prepare(`SELECT COUNT(*) AS n FROM hive_mind WHERE agent = ? AND created_at >= ?`)
        .get(name, startOfDay) as { n: number };
      const yamlPath = join(AGENTS_ROOT, name, "agent.yaml");
      let model = "claude-sonnet-4-6";
      let role = "";
      if (existsSync(yamlPath)) {
        try {
          const cfg = yaml.parse(readFileSync(yamlPath, "utf8")) as
            { model?: string; role?: string };
          model = cfg.model ?? model;
          role = cfg.role ?? "";
        } catch { /* ignore */ }
      }
      const status = runtime[name]?.status ?? "running";
      return { name, status, turns: total.n, today_turns: today.n, model, role };
    });
    return c.json({ agents: list });
  });

  // Read full agent.yaml + CLAUDE.md
  app.get("/:name/config", (c) => {
    const name = c.req.param("name");
    const dir = join(AGENTS_ROOT, name);
    if (!existsSync(dir)) return c.json({ error: "not found" }, 404);
    const yamlPath = join(dir, "agent.yaml");
    const mdPath = join(dir, "CLAUDE.md");
    return c.json({
      name,
      yaml: existsSync(yamlPath) ? readFileSync(yamlPath, "utf8") : "",
      claude_md: existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "",
    });
  });

  // Edit model only — most common UI action (transcript ch.10).
  app.post("/:name/model", async (c) => {
    const name = c.req.param("name");
    const { model } = (await c.req.json()) as { model: string };
    if (!/^claude-(opus|sonnet|haiku)-\d+(-\d+)?$/.test(model)) {
      return c.json({ error: "model must look like claude-{opus|sonnet|haiku}-N-N" }, 400);
    }
    const yamlPath = join(AGENTS_ROOT, name, "agent.yaml");
    if (!existsSync(yamlPath)) return c.json({ error: "agent.yaml missing" }, 404);
    const raw = readFileSync(yamlPath, "utf8");
    const updated = raw.replace(/^model:\s*\S+/m, `model: ${model}`);
    writeFileSync(yamlPath, updated);
    return c.json({ ok: true, model });
  });

  // Stop / start / restart (sets runtime flag; bridge respects it on next turn).
  app.post("/:name/runtime", async (c) => {
    const name = c.req.param("name");
    const { action } = (await c.req.json()) as { action: "start" | "stop" | "restart" };
    if (!["start", "stop", "restart"].includes(action)) {
      return c.json({ error: "action must be start|stop|restart" }, 400);
    }
    const m = readRuntime();
    m[name] = m[name] ?? { status: "running", today_turns: 0 };
    m[name].status = action === "stop" ? "stopped" : "running";
    writeRuntime(m);
    return c.json({ name, status: m[name].status });
  });

  // Chat history per agent — used by the Chat tab.
  app.get("/:name/chat", (c) => {
    const name = c.req.param("name");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const rows = db
      .prepare(
        `SELECT id, prompt, reply, created_at FROM hive_mind
         WHERE agent = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(name, limit);
    return c.json({ agent: name, rows });
  });

  // A3 — Create new agent from dashboard.
  // Copies agents/_template/, patches yaml + CLAUDE.md, returns BotFather link.
  app.post("/", async (c) => {
    const body = (await c.req.json()) as {
      name?: string;
      role?: string;
      description?: string;
      model?: string;
      voice?: string;
      persona?: string;
    };
    const name = (body.name ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,15}$/.test(name)) {
      return c.json({ error: "name must be lowercase snake_case, 2-16 chars, start with a letter" }, 400);
    }
    if (name.startsWith("_") || ["main","meta","comms","content","ops","research","_template"].includes(name) === false && existsSync(join(AGENTS_ROOT, name))) {
      return c.json({ error: `agent "${name}" already exists or name reserved` }, 409);
    }
    const tplDir = join(AGENTS_ROOT, "_template");
    const newDir = join(AGENTS_ROOT, name);
    if (!existsSync(tplDir)) return c.json({ error: "agents/_template/ missing" }, 500);
    if (existsSync(newDir)) return c.json({ error: "directory already exists" }, 409);

    // Copy template files.
    mkdirSync(newDir, { recursive: true });
    const tplYaml = readFileSync(join(tplDir, "agent.yaml"), "utf8");
    const tplMd = readFileSync(join(tplDir, "CLAUDE.md"), "utf8");

    // Patch yaml.
    const role = (body.role ?? "specialist").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    const model = body.model ?? "claude-sonnet-4-6";
    const voice = body.voice ?? "Charon";
    if (!/^claude-(opus|sonnet|haiku)-\d+(-\d+)?$/.test(model)) {
      return c.json({ error: "invalid model" }, 400);
    }
    let yamlOut = tplYaml
      .replace(/^name:.*$/m, `name: ${name}`)
      .replace(/^role:.*$/m, `role: ${role}`)
      .replace(/^model:.*$/m, `model: ${model}`)
      .replace(/^voice:.*$/m, `voice: ${voice}`)
      .replace(/<agent_name>/g, name)
      .replace(/<AgentName>/g, name[0].toUpperCase() + name.slice(1));
    writeFileSync(join(newDir, "agent.yaml"), yamlOut);

    // Patch CLAUDE.md.
    const display = name[0].toUpperCase() + name.slice(1);
    const persona = body.persona ?? body.description ?? "Custom agent.";
    const tagline = body.description ?? "Specialist agent";
    let mdOut = tplMd
      .replace(/<Agent Name>/g, display)
      .replace(/<One-line tagline>/g, tagline)
      .replace(/<role>/g, role.replace(/_/g, " "))
      .replace(/<One sentence — what is this agent's job, in plain language\?>/g, persona);
    writeFileSync(join(newDir, "CLAUDE.md"), mdOut);

    // Append voice entry to voices.yaml (best effort; non-fatal if missing).
    const voicesPath = resolve(process.cwd(), "../../apps/warroom/voices.yaml");
    if (existsSync(voicesPath)) {
      try {
        const v = readFileSync(voicesPath, "utf8");
        if (!v.includes(`  ${name}:`)) {
          const append = `  ${name}:\n    voice: ${voice}\n    style: configured at create time\n`;
          writeFileSync(voicesPath, v.trimEnd() + "\n" + append);
        }
      } catch { /* non-fatal */ }
    }

    return c.json({
      ok: true,
      name,
      directory: `agents/${name}/`,
      next_steps: [
        "Get a Telegram bot token from https://t.me/BotFather",
        `Add it to .env (e.g. TELEGRAM_BOT_TOKEN_${name.toUpperCase()}=...)`,
        "Restart the bridge service",
      ],
      botfather_url: "https://t.me/BotFather",
    });
  });

  app.get("/:name/recent", (c) => {
    const name = c.req.param("name");
    const rows = db
      .prepare(
        `SELECT id, prompt, reply, created_at FROM hive_mind
         WHERE agent = ? ORDER BY created_at DESC LIMIT 25`,
      )
      .all(name);
    return c.json({ rows });
  });

  // Structural load analysis — surface overloaded agents without an LLM call.
  app.get("/suggestions", (c) => {
    const days = Math.min(Number(c.req.query("days") ?? 7), 90);
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const counts = db
      .prepare(
        `SELECT agent, COUNT(*) AS n FROM hive_mind
         WHERE created_at >= ? GROUP BY agent ORDER BY n DESC`,
      )
      .all(cutoff) as Array<{ agent: string; n: number }>;

    if (!counts.length) return c.json({ suggestions: [], counts: [] });

    const total = counts.reduce((a, b) => a + b.n, 0);
    const avg = total / counts.length;
    const overloaded = counts.filter((r) => r.n > avg * 2 && r.n >= 10);

    const suggestions = overloaded.map((r) => ({
      agent: r.agent,
      count: r.n,
      avg: Math.round(avg),
      ratio: Math.round((r.n / avg) * 10) / 10,
    }));

    return c.json({ suggestions, counts, avg: Math.round(avg), period_days: days });
  });

  // Hive activity feed — last N entries across all agents.
  app.get("/hive", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);
    const rows = db
      .prepare(
        `SELECT id, agent, prompt, reply, created_at FROM hive_mind
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
    return c.json({ rows });
  });

  return app;
}

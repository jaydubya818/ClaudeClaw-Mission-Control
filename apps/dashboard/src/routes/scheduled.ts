// Scheduled tasks CRUD — V3 transcript ch.10.
// User-editable missions live in the scheduled_tasks SQLite table; YAML
// missions in scheduler/cron.yaml remain code-managed (deployed alongside
// the runner). Both are surfaced together by /api/schedule (read).
//
// GET    /api/scheduled               → list user-editable missions
// POST   /api/scheduled               → create
// PATCH  /api/scheduled/:id           → update fields
// DELETE /api/scheduled/:id           → remove
// POST   /api/scheduled/:id/toggle    → flip enabled
// POST   /api/scheduled/:id/run-now   → fire immediately (writes intent; runner picks up)

import { Hono } from "hono";
import type Database from "better-sqlite3";

const VALID_AGENTS = new Set([
  "main", "meta", "comms", "content", "ops", "research",
]);

type ScheduledRow = {
  id: number;
  name: string;
  schedule: string;
  agent: string;
  prompt: string;
  enabled: number;
  last_run_at: number | null;
  last_status: string | null;
  created_at: number;
  updated_at: number;
};

export default function scheduledRoute(db: Database.Database) {
  const app = new Hono();
  const now = () => Math.floor(Date.now() / 1000);

  app.get("/", (c) => {
    const rows = db
      .prepare(`SELECT * FROM scheduled_tasks ORDER BY id DESC`)
      .all() as ScheduledRow[];
    return c.json({ rows });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json()) as Partial<ScheduledRow>;
    if (!body.name || !body.schedule || !body.agent || !body.prompt) {
      return c.json({ error: "name, schedule, agent, prompt required" }, 400);
    }
    if (!VALID_AGENTS.has(body.agent)) {
      return c.json({ error: `agent must be one of ${[...VALID_AGENTS].join(",")}` }, 400);
    }
    if (!isValidCron(body.schedule)) {
      return c.json({ error: "invalid cron expression" }, 400);
    }
    const t = now();
    try {
      const info = db
        .prepare(
          `INSERT INTO scheduled_tasks
             (name, schedule, agent, prompt, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(body.name, body.schedule, body.agent, body.prompt, t, t);
      return c.json({ id: info.lastInsertRowid });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<ScheduledRow>;
    const existing = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id);
    if (!existing) return c.json({ error: "not found" }, 404);

    if (body.agent && !VALID_AGENTS.has(body.agent)) {
      return c.json({ error: "invalid agent" }, 400);
    }
    if (body.schedule && !isValidCron(body.schedule)) {
      return c.json({ error: "invalid cron" }, 400);
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    for (const k of ["name", "schedule", "agent", "prompt"] as const) {
      if (body[k] != null) {
        fields.push(`${k} = ?`);
        params.push(body[k]);
      }
    }
    if (typeof body.enabled === "number") {
      fields.push(`enabled = ?`);
      params.push(body.enabled ? 1 : 0);
    }
    if (!fields.length) return c.json({ error: "nothing to update" }, 400);
    fields.push(`updated_at = ?`);
    params.push(now(), id);
    db.prepare(`UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    return c.json({ ok: true });
  });

  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
    return c.json({ ok: true });
  });

  app.post("/:id/toggle", (c) => {
    const id = Number(c.req.param("id"));
    db.prepare(
      `UPDATE scheduled_tasks SET enabled = 1 - enabled, updated_at = ? WHERE id = ?`,
    ).run(now(), id);
    const row = db.prepare(`SELECT enabled FROM scheduled_tasks WHERE id = ?`).get(id) as
      | { enabled: number } | undefined;
    return c.json({ enabled: !!row?.enabled });
  });

  // "Run now" — write a row to tasks table for the runner to pick up immediately.
  app.post("/:id/run-now", (c) => {
    const id = Number(c.req.param("id"));
    const row = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`).get(id) as
      | ScheduledRow | undefined;
    if (!row) return c.json({ error: "not found" }, 404);
    const t = now();
    const info = db
      .prepare(
        `INSERT INTO tasks (title, description, agent, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, 'medium', 'queued', ?, ?)`,
      )
      .run(`[ad hoc] ${row.name}`, row.prompt, row.agent, t, t);
    return c.json({ ok: true, task_id: info.lastInsertRowid });
  });

  return app;
}

// Minimal cron validator: 5 fields, each is *, a number, a list, or a range.
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) =>
    /^(\*|(\d+|\d+-\d+)(,(\d+|\d+-\d+))*|\*\/\d+|\d+-\d+\/\d+)$/.test(p),
  );
}

import { Hono } from "hono";
import type Database from "better-sqlite3";
import { pickAgent } from "../assign.js";
import { runTask } from "../task-runner.js";

export default function tasksRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC`)
      .all();
    return c.json({ rows });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json()) as {
      title: string;
      description?: string;
      priority?: "low" | "medium" | "high";
    };
    const now = Math.floor(Date.now() / 1000);
    const info = db
      .prepare(
        `INSERT INTO tasks (title, description, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?)`,
      )
      .run(body.title, body.description ?? "", body.priority ?? "medium", now, now);
    return c.json({ id: info.lastInsertRowid });
  });

  // Manual assign.
  app.post("/:id/assign", async (c) => {
    const id = Number(c.req.param("id"));
    const { agent } = (await c.req.json()) as { agent: string };
    db.prepare(
      `UPDATE tasks SET agent = ?, updated_at = ? WHERE id = ?`,
    ).run(agent, Math.floor(Date.now() / 1000), id);
    return c.json({ ok: true });
  });

  // Auto-assign via Gemini 2.5 Flash.
  // V3 page 4 kill switch: MISSION_AUTO_ASSIGN_ENABLED=false → returns 403
  // and forces manual routing.
  app.post("/:id/auto-assign", async (c) => {
    if (process.env.MISSION_AUTO_ASSIGN_ENABLED === "false") {
      return c.json({ error: "auto-assign disabled (MISSION_AUTO_ASSIGN_ENABLED=false)" }, 403);
    }
    const id = Number(c.req.param("id"));
    const task = db.prepare(`SELECT title, description FROM tasks WHERE id = ?`).get(id) as
      | { title: string; description: string }
      | undefined;
    if (!task) return c.json({ error: "not found" }, 404);
    const agent = await pickAgent(task);
    db.prepare(
      `UPDATE tasks SET agent = ?, updated_at = ? WHERE id = ?`,
    ).run(agent, Math.floor(Date.now() / 1000), id);
    return c.json({ agent });
  });

  app.post("/:id/status", async (c) => {
    const id = Number(c.req.param("id"));
    const { status } = (await c.req.json()) as { status: string };
    db.prepare(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`,
    ).run(status, Math.floor(Date.now() / 1000), id);
    // If user flips to 'live', kick off in-process execution.
    if (status === "live") {
      runTask(db, id).catch((e) => console.error(`[tasks] runTask #${id}:`, e));
    }
    return c.json({ ok: true });
  });

  // Explicit run endpoint — fire-and-forget; UI polls /api/tasks/:id for completion.
  app.post("/:id/run", async (c) => {
    const id = Number(c.req.param("id"));
    const t = db.prepare(`SELECT id, agent FROM tasks WHERE id=?`).get(id) as
      { id: number; agent: string | null } | undefined;
    if (!t) return c.json({ error: "not found" }, 404);
    if (!t.agent) return c.json({ error: "task has no agent — auto-assign first" }, 400);
    // Fire and forget — runTask updates the row directly.
    runTask(db, id).catch((e) => console.error(`[tasks] runTask #${id}:`, e));
    return c.json({ ok: true, task_id: id, status: "live" });
  });

  // Single-task fetch — used by UI to poll for completion.
  app.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = db.prepare(`SELECT * FROM tasks WHERE id=?`).get(id);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  });

  // Retry endpoint — clears error/result, sets back to queued.
  app.post("/:id/retry", async (c) => {
    const id = Number(c.req.param("id"));
    db.prepare(
      `UPDATE tasks SET status='queued', error=NULL, result=NULL,
                        started_at=NULL, finished_at=NULL, updated_at=?
        WHERE id=?`,
    ).run(Math.floor(Date.now() / 1000), id);
    return c.json({ ok: true });
  });

  // Delete — proper hard delete.
  app.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.prepare(`DELETE FROM tasks WHERE id=?`).run(id);
    return c.json({ ok: true });
  });

  return app;
}


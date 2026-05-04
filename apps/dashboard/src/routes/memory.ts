import { Hono } from "hono";
import type Database from "better-sqlite3";

export default function memoryRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/stats", (c) => {
    const mem = db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number };
    const ins = db.prepare(`SELECT COUNT(*) AS n FROM insights`).get() as { n: number };
    const pin = db.prepare(`SELECT COUNT(*) AS n FROM pinned`).get() as { n: number };
    return c.json({ memories: mem.n, insights: ins.n, pinned: pin.n });
  });

  app.get("/distribution", (c) => {
    const buckets = db
      .prepare(
        `SELECT
           CASE
             WHEN importance < 0.2 THEN '0.0-0.2'
             WHEN importance < 0.4 THEN '0.2-0.4'
             WHEN importance < 0.6 THEN '0.4-0.6'
             WHEN importance < 0.8 THEN '0.6-0.8'
             ELSE '0.8-1.0'
           END AS bucket,
           COUNT(*) AS n
         FROM memories GROUP BY bucket ORDER BY bucket`,
      )
      .all();
    return c.json({ buckets });
  });

  app.get("/pinned", (c) => {
    const rows = db.prepare(`SELECT * FROM pinned ORDER BY id DESC`).all();
    return c.json({ rows });
  });

  app.post("/pinned", async (c) => {
    const { content, scope } = (await c.req.json()) as {
      content: string;
      scope: string;
    };
    db.prepare(
      `INSERT INTO pinned (content, scope, created_at) VALUES (?, ?, ?)`,
    ).run(content, scope, Math.floor(Date.now() / 1000));
    return c.json({ ok: true });
  });

  app.delete("/pinned/:id", (c) => {
    const id = Number(c.req.param("id"));
    db.prepare(`DELETE FROM pinned WHERE id = ?`).run(id);
    return c.json({ ok: true });
  });

  // FTS5 full-text search across memories.content.
  app.get("/search", (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ rows: [] });
    try {
      const rows = db
        .prepare(
          `SELECT m.id, m.agent, m.content, m.kind, m.importance, m.created_at
           FROM memories_fts f
           JOIN memories m ON m.id = f.rowid
           WHERE memories_fts MATCH ?
           ORDER BY rank
           LIMIT 20`,
        )
        .all(q);
      return c.json({ rows });
    } catch {
      // FTS syntax error — fall back to LIKE.
      const rows = db
        .prepare(
          `SELECT id, agent, content, kind, importance, created_at
           FROM memories WHERE content LIKE ? ORDER BY importance DESC LIMIT 20`,
        )
        .all(`%${q}%`);
      return c.json({ rows });
    }
  });

  // Insights from the insights table (Gemini extractor writes here).
  app.get("/insights", (c) => {
    const rows = db
      .prepare(`SELECT * FROM insights ORDER BY created_at DESC LIMIT 25`)
      .all();
    return c.json({ rows });
  });

  // Recent memories for the landscape view.
  app.get("/recent", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
    const rows = db
      .prepare(
        `SELECT id, agent, content, kind, importance, created_at
         FROM memories ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
    return c.json({ rows });
  });

  // Today's hive turn counts (used for Turns Today dashboard stat).
  app.get("/today", (c) => {
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const rows = db
      .prepare(
        `SELECT agent, COUNT(*) AS n FROM hive_mind
         WHERE created_at >= ? GROUP BY agent`,
      )
      .all(startOfDay) as Array<{ agent: string; n: number }>;
    const total = rows.reduce((a, b) => a + b.n, 0);
    return c.json({ total, by_agent: rows });
  });

  return app;
}

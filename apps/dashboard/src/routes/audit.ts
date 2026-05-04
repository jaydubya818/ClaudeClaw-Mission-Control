// Audit log viewer — V3 PDF p10.
// Reads from the `audit` SQLite table (indexed) and falls back to tailing
// security/audit.log when the table is empty (early-stage installs).
//
// GET /api/audit?limit=200&agent=ops&since=<ts>

import { Hono } from "hono";
import type Database from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export default function auditRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 200), 1000);
    const agent = c.req.query("agent");
    const since = Number(c.req.query("since") ?? 0);

    const params: unknown[] = [];
    let sql = `SELECT id, ts, agent, action, correlation_id, payload_hash, pinned FROM audit WHERE ts >= ?`;
    params.push(since);
    if (agent) {
      sql += ` AND agent = ?`;
      params.push(agent);
    }
    sql += ` ORDER BY ts DESC LIMIT ?`;
    params.push(limit);

    let rows = db.prepare(sql).all(...params) as Array<{
      id: number;
      ts: number;
      agent: string | null;
      action: string;
      correlation_id: string | null;
      payload_hash: string | null;
      pinned: number;
    }>;

    // Fallback to file tail if table is empty.
    if (rows.length === 0) {
      const file = resolve(process.cwd(), "../../security/audit.log");
      if (existsSync(file)) {
        const tail = readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .slice(-limit)
          .reverse();
        return c.json({ rows: [], file_tail: tail });
      }
    }
    return c.json({ rows });
  });

  return app;
}

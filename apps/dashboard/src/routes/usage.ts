// Usage analytics — V3 sidebar "Usage" tab.
// Roll up the `usage` table by agent and day. Reads-only, sub-second queries.

import { Hono } from "hono";
import type Database from "better-sqlite3";

export default function usageRoute(db: Database.Database) {
  const app = new Hono();

  // Per-agent totals over the last N days (default 30).
  app.get("/", (c) => {
    const days = Math.min(Number(c.req.query("days") ?? 30), 365);
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = db
      .prepare(
        `SELECT agent,
                SUM(input_tok)  AS in_tok,
                SUM(output_tok) AS out_tok,
                SUM(cost_usd)   AS cost,
                COUNT(*)        AS turns
         FROM usage WHERE ts >= ? GROUP BY agent ORDER BY cost DESC`,
      )
      .all(cutoff);
    type Total = { in_tok: number; out_tok: number; cost: number; turns: number };
    const total = (rows as Array<Partial<Total>>).reduce<Total>(
      (a, r) => ({
        in_tok: a.in_tok + (r.in_tok ?? 0),
        out_tok: a.out_tok + (r.out_tok ?? 0),
        cost: a.cost + (r.cost ?? 0),
        turns: a.turns + (r.turns ?? 0),
      }),
      { in_tok: 0, out_tok: 0, cost: 0, turns: 0 },
    );
    return c.json({ days, by_agent: rows, total });
  });

  // Daily timeseries — for a sparkline chart.
  app.get("/daily", (c) => {
    const days = Math.min(Number(c.req.query("days") ?? 30), 365);
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = db
      .prepare(
        `SELECT date(ts, 'unixepoch') AS day,
                SUM(cost_usd) AS cost,
                COUNT(*) AS turns
         FROM usage WHERE ts >= ? GROUP BY day ORDER BY day`,
      )
      .all(cutoff);
    return c.json({ days, rows });
  });

  return app;
}

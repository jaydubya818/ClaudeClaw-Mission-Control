// Hive Mind data endpoint — feeds list view (already in agents.ts), 2D graph,
// and 3D brain. V3 PDF p9.
//
// GET /api/hive?period=24h|7d|30d&q=<search>  →  {nodes, edges, list}
//
// Nodes: one per agent + one per task.
// Edges: agent → task (assigned), task → task (within same agent, time-adjacent).

import { Hono } from "hono";
import type Database from "better-sqlite3";

const VALID_PERIODS = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 };

export default function hiveRoute(db: Database.Database) {
  const app = new Hono();

  app.get("/", (c) => {
    const period = (c.req.query("period") ?? "7d") as keyof typeof VALID_PERIODS;
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    if (!(period in VALID_PERIODS)) return c.json({ error: "bad period" }, 400);
    const cutoff = Math.floor(Date.now() / 1000) - VALID_PERIODS[period];

    const params: any[] = [cutoff];
    let sql = `SELECT id, agent, prompt, reply, created_at FROM hive_mind WHERE created_at >= ?`;
    if (q) {
      sql += ` AND (LOWER(prompt) LIKE ? OR LOWER(reply) LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ` ORDER BY created_at DESC LIMIT 500`;

    const rows = db.prepare(sql).all(...params) as Array<{
      id: number;
      agent: string;
      prompt: string;
      reply: string;
      created_at: number;
    }>;

    // Group tasks by agent for adjacency edges.
    const byAgent: Record<string, typeof rows> = {};
    for (const r of rows) {
      (byAgent[r.agent] ??= []).push(r);
    }

    const agents = Object.keys(byAgent);
    const nodes = [
      // Agent supernodes
      ...agents.map((a) => ({
        data: { id: `agent:${a}`, label: a, type: "agent", size: byAgent[a].length },
      })),
      // Task nodes
      ...rows.map((r) => ({
        data: {
          id: `task:${r.id}`,
          label: r.prompt.slice(0, 40) + (r.prompt.length > 40 ? "…" : ""),
          fullPrompt: r.prompt,
          type: "task",
          agent: r.agent,
          createdAt: r.created_at,
        },
      })),
    ];

    const edges: Array<{ data: { source: string; target: string; type: string } }> = [];
    for (const r of rows) {
      edges.push({
        data: { source: `agent:${r.agent}`, target: `task:${r.id}`, type: "assigned" },
      });
    }
    // Time-adjacent edges within same agent
    for (const a of agents) {
      const sorted = byAgent[a].sort((x, y) => x.created_at - y.created_at);
      for (let i = 1; i < sorted.length; i++) {
        edges.push({
          data: {
            source: `task:${sorted[i - 1].id}`,
            target: `task:${sorted[i].id}`,
            type: "next",
          },
        });
      }
    }

    return c.json({
      period,
      query: q,
      nodes,
      edges,
      list: rows.map((r) => ({
        id: r.id,
        agent: r.agent,
        prompt: r.prompt,
        reply: r.reply,
        created_at: r.created_at,
      })),
      counts: { agents: agents.length, tasks: rows.length },
    });
  });

  return app;
}

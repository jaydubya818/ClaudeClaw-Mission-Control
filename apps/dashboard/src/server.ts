// Mission Control — Hono on :3141.
// Endpoints: agents, tasks, memory landscape, auto-assign.

import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import Database from "better-sqlite3";

import agentsRoute from "./routes/agents.js";
import tasksRoute from "./routes/tasks.js";
import memoryRoute from "./routes/memory.js";
import hiveRoute from "./routes/hive.js";
import suggestionsRoute from "./routes/suggestions.js";
import scheduleRoute from "./routes/schedule.js";
import scheduledRoute from "./routes/scheduled.js";
import auditRoute from "./routes/audit.js";
import usageRoute from "./routes/usage.js";

const DB_PATH = process.env.DB_PATH ?? "./store/claudeclaw.db";
const PORT = Number(process.env.DASHBOARD_PORT ?? 3141);
const PIN = process.env.DASHBOARD_PIN ?? "";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const app = new Hono();

// PIN gate — simple cookie check. Good enough behind Cloudflare Access.
app.use(async (c, next) => {
  if (!PIN) return next();
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/unlock")) return next();
  const cookie = c.req.header("cookie") ?? "";
  if (cookie.includes(`cc_pin=${PIN}`)) return next();
  return c.redirect("/unlock.html");
});

app.post("/unlock", async (c) => {
  const body = await c.req.parseBody();
  if (body.pin !== PIN) return c.text("nope", 401);
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `cc_pin=${PIN}; Path=/; HttpOnly; SameSite=Strict`,
    },
  });
});

app.route("/api/agents", agentsRoute(db));
app.route("/api/tasks", tasksRoute(db));
app.route("/api/memory", memoryRoute(db));
app.route("/api/hive", hiveRoute(db));
app.route("/api/suggestions", suggestionsRoute(db));
app.route("/api/schedule", scheduleRoute());
app.route("/api/scheduled", scheduledRoute(db));
app.route("/api/audit", auditRoute(db));
app.route("/api/usage", usageRoute(db));

app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT });
console.log(`dashboard :${PORT}`);

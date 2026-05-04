// Schedule tab — V3 PDF p5 / transcript ch.10.
// GET  /api/schedule          → list missions from cron.yaml with English translation
// POST /api/schedule/toggle   → flip SCHEDULER_ENABLED runtime flag (process-local)

import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "yaml";

// Local cron-to-English translator. Mirror of scheduler/cron-to-english.ts —
// inlined here so this route compiles within apps/dashboard/src rootDir.
// See scheduler/cron-to-english.ts for the canonical version + self-tests.
const _DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const _MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function _ord(n: number): string {
  const s = ["th", "st", "nd", "rd"]; const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function cronToEnglish(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [min, hour, dom, month, dow] = p;
  const time = (() => {
    if (hour === "*" && min === "*") return "every minute";
    if (hour === "*") return `:${min.padStart(2, "0")} of every hour`;
    if (min === "*") return `every minute of hour ${hour}`;
    const h = Number(hour), m = Number(min);
    if (Number.isNaN(h) || Number.isNaN(m)) return `${hour}:${min}`;
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  })();
  const days = (() => {
    if (dow === "*") return "";
    if (dow === "1-5") return "Weekdays";
    if (dow === "0,6" || dow === "6,0") return "Weekends";
    if (/^\d$/.test(dow)) return _DAYS[Number(dow)] + "s";
    if (/^\d(,\d)+$/.test(dow)) return dow.split(",").map((d) => _DAYS[Number(d)]).join(", ");
    return dow;
  })();
  const monthly = (() => {
    if (dom === "*" && month === "*") return "";
    if (dom !== "*" && month === "*") return `the ${_ord(Number(dom))} of every month`;
    if (dom !== "*" && month !== "*") return `${_MONTHS[Number(month) - 1]} ${_ord(Number(dom))}`;
    return "";
  })();
  if (dow !== "*" && dom === "*" && month === "*") return `${days} at ${time}`;
  if (dom === "*" && month === "*" && dow === "*") return `Every day at ${time}`;
  if (monthly && dow === "*") return `${monthly} at ${time}`;
  return `${days || "Every day"} ${monthly ? "(" + monthly + ")" : ""} at ${time}`.trim();
}

type Mission = {
  name: string;
  schedule: string;
  agent: string;
  prompt: string;
};

// Process-local override; takes precedence over env until restart.
let runtimeEnabled: boolean | null = null;

export default function scheduleRoute() {
  const app = new Hono();

  app.get("/", (c) => {
    const path = resolve(process.cwd(), "../../scheduler/cron.yaml");
    let cfg: { missions: Mission[] };
    try {
      cfg = yaml.parse(readFileSync(path, "utf8")) as { missions: Mission[] };
    } catch (e) {
      return c.json({ error: `cron.yaml read failed: ${(e as Error).message}` }, 500);
    }

    const enabled =
      runtimeEnabled ?? (process.env.SCHEDULER_ENABLED !== "false");

    const missions = cfg.missions.map((m) => ({
      name: m.name,
      schedule: m.schedule,
      schedule_human: cronToEnglish(m.schedule),
      agent: m.agent,
      prompt_preview: m.prompt.trim().slice(0, 200),
    }));

    return c.json({ enabled, missions });
  });

  app.post("/toggle", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "body must include {enabled: boolean}" }, 400);
    }
    runtimeEnabled = body.enabled;
    return c.json({ enabled: runtimeEnabled });
  });

  return app;
}

// Scheduler — parses cron.yaml, fires named missions to the bridge queue.
// Deliberately minimal: wraps node-cron, POSTs to the bridge's internal enqueue
// endpoint (or invokes the SDK directly — up to you based on how you'd like
// the audit trail to look).

import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import cron from "node-cron";
import yaml from "yaml";

type Mission = {
  name: string;
  schedule: string;
  agent: string;
  prompt: string;
};

// V3 page 5 kill switch — flip to false to halt all scheduled missions
// without restarting the process or removing plists.
const SCHEDULER_ENABLED = process.env.SCHEDULER_ENABLED !== "false";

// Primary chat ID for scheduled mission delivery.
// Set TELEGRAM_PRIMARY_CHAT_ID in .env (same value as TELEGRAM_ALLOWED_CHAT_IDS primary entry).
const PRIMARY_CHAT_ID = process.env.TELEGRAM_PRIMARY_CHAT_ID ?? "";
const BRIDGE_INTERNAL_PORT = Number(process.env.BRIDGE_INTERNAL_PORT ?? 3142);

const cfg = yaml.parse(
  readFileSync(resolve(process.cwd(), "scheduler/cron.yaml"), "utf8"),
) as { missions: Mission[] };

console.log(`[scheduler] loaded ${cfg.missions.length} missions (enabled=${SCHEDULER_ENABLED})`);

for (const m of cfg.missions) {
  if (!cron.validate(m.schedule)) {
    console.error(`[scheduler] invalid cron for ${m.name}: ${m.schedule}`);
    continue;
  }
  cron.schedule(m.schedule, async () => {
    if (!SCHEDULER_ENABLED) {
      console.log(`[scheduler] SKIP ${m.name} (SCHEDULER_ENABLED=false)`);
      return;
    }
    if (!PRIMARY_CHAT_ID) {
      console.error(`[scheduler] SKIP ${m.name} — TELEGRAM_PRIMARY_CHAT_ID unset`);
      return;
    }
    console.log(`[scheduler] fire ${m.name} → ${m.agent}`);
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_INTERNAL_PORT}/enqueue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: PRIMARY_CHAT_ID, text: m.prompt }),
      });
      if (!res.ok) {
        console.error(`[scheduler] fire.error ${m.name}: bridge returned ${res.status}`);
      } else {
        console.log(`[scheduler] fired ${m.name} → bridge acknowledged`);
      }
    } catch (e) {
      console.error(`[scheduler] fire.error ${m.name}:`, String(e));
    }
  });
  console.log(`[scheduler] armed ${m.name} (${m.schedule})`);
}

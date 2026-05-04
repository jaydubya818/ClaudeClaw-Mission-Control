// A8 — /insights slash command runner.
// Spawns memory/insights.py and returns its rendered output for Telegram.

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(process.cwd(), "../../");
const PYTHON = process.env.PYTHON_BIN ?? "python3";
const TIMEOUT_MS = 90_000;

export async function runInsightsCommand(period: string): Promise<string> {
  // Validate period strictly to avoid shelling unsanitized input.
  if (!/^\d+d$/.test(period)) period = "7d";

  return new Promise<string>((resolveFn) => {
    const proc = spawn(PYTHON, ["-m", "memory.insights", "--period", period], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolveFn(`⚠️ Insights timed out after ${TIMEOUT_MS / 1000}s`);
    }, TIMEOUT_MS);

    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolveFn(
          `⚠️ insights exited ${code}\n\`\`\`\n${(stderr || "no stderr").slice(0, 400)}\n\`\`\``,
        );
        return;
      }
      // Telegram message limit: 4096 chars; trim for safety.
      const out = stdout.trim() || "(no output)";
      resolveFn(out.length > 3500 ? out.slice(0, 3500) + "\n…[truncated]" : out);
    });
  });
}

// 5-layer memory retrieval. Called at the start of every agent session.
//
//   1. Pinned (always)
//   2. Top-K importance > 0.7 for this agent
//   3. Last 20 hive_mind messages
//   4. Semantic top-5 vs. first user message (cosine on 768-dim Gemini embeddings)
//   5. Obsidian folder snippet for this agent
//
// The result is a string block prepended to the agent's CLAUDE.md system prompt.

import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface InjectOpts {
  dbPath: string;
  agent: string;
  firstMessage: string;
  embed: (text: string) => Promise<number[]>;
  obsidianRoot?: string; // e.g. "~/Obsidian"
  obsidianFolder?: string; // agent-specific subfolder
}

export async function buildInjectBlock(opts: InjectOpts): Promise<string> {
  const db = new Database(opts.dbPath, { readonly: true });
  try {
    const pinned = db
      .prepare(`SELECT content FROM pinned WHERE scope IN ('global', ?) ORDER BY id`)
      .all(opts.agent) as { content: string }[];

    const hi = db
      .prepare(
        `SELECT content FROM memories WHERE agent = ? AND importance > 0.7
         ORDER BY importance DESC LIMIT 10`,
      )
      .all(opts.agent) as { content: string }[];

    const recent = db
      .prepare(
        `SELECT prompt, reply FROM hive_mind WHERE agent = ?
         ORDER BY created_at DESC LIMIT 20`,
      )
      .all(opts.agent) as { prompt: string; reply: string }[];

    const semantic = await semanticTop(db, opts.agent, opts.firstMessage, opts.embed, 5);

    const obsidian =
      opts.obsidianRoot && opts.obsidianFolder
        ? readObsidian(join(opts.obsidianRoot, opts.obsidianFolder))
        : "";

    return [
      section("PINNED", pinned.map((p) => `- ${p.content}`).join("\n")),
      section("HIGH-IMPORTANCE MEMORIES", hi.map((h) => `- ${h.content}`).join("\n")),
      section(
        "RECENT HIVE MIND",
        recent
          .reverse()
          .map((r) => `- "${r.prompt.slice(0, 80)}" → "${r.reply.slice(0, 120)}"`)
          .join("\n"),
      ),
      section("SEMANTICALLY RELEVANT", semantic.map((s) => `- ${s}`).join("\n")),
      section("OBSIDIAN NOTES", obsidian),
    ]
      .filter(Boolean)
      .join("\n\n");
  } finally {
    db.close();
  }
}

function section(title: string, body: string): string {
  return body?.trim() ? `## ${title}\n${body.trim()}` : "";
}

async function semanticTop(
  db: Database.Database,
  agent: string,
  query: string,
  embed: (t: string) => Promise<number[]>,
  k: number,
): Promise<string[]> {
  const q = await embed(query);
  // Pull this-agent memories first (boosted), then cross-agent (de-prioritized).
  // Lets the active agent benefit from peer agents' findings without drowning
  // its own context. Cross-agent matches must clear a higher bar (boost penalty).
  const own = db
    .prepare(
      `SELECT m.id, m.content, m.agent, e.vector FROM memories m
       JOIN embeddings e ON e.memory_id = m.id
       WHERE m.agent = ?`,
    )
    .all(agent) as MemRow[];
  const cross = db
    .prepare(
      `SELECT m.id, m.content, m.agent, e.vector FROM memories m
       JOIN embeddings e ON e.memory_id = m.id
       WHERE m.agent IS NOT NULL AND m.agent != ?`,
    )
    .all(agent) as MemRow[];

  const scored = [
    ...own.map((r) => ({
      id: r.id, content: r.content, agent: r.agent,
      score: cosine(q, bufToFloats(r.vector)),
    })),
    ...cross.map((r) => ({
      id: r.id, content: r.content, agent: r.agent,
      // Penalize cross-agent matches so they only surface when very relevant.
      score: cosine(q, bufToFloats(r.vector)) - 0.10,
    })),
  ];
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, k)
    // Only surface scores above a small floor to avoid noise.
    .filter((s) => s.score > 0.3)
    .map((s) => s.agent === agent
      ? s.content
      : `(via ${s.agent}) ${s.content}`);
}

interface MemRow { id: number; content: string; agent: string; vector: Buffer }

function bufToFloats(buf: Buffer): number[] {
  const out: number[] = new Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function cosine(a: number[], b: number[]): number {
  let num = 0, da = 0, db = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    num += a[i] * b[i];
    da += a[i] * a[i];
    db += b[i] * b[i];
  }
  return da && db ? num / (Math.sqrt(da) * Math.sqrt(db)) : 0;
}

function readObsidian(dir: string, maxBytes = 8000): string {
  if (!existsSync(dir)) return "";
  const chunks: string[] = [];
  let bytes = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const p = join(dir, entry);
    if (!statSync(p).isFile()) continue;
    const txt = readFileSync(p, "utf8");
    chunks.push(`### ${entry}\n${txt}`);
    bytes += txt.length;
    if (bytes > maxBytes) break;
  }
  return chunks.join("\n\n");
}

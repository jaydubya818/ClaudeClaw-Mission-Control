// Routes an incoming message to an agent.
//   1. Explicit prefix: "comms: …", "ops: …"
//   2. Broadcast keywords: everyone, team, status update → main (who will fan out)
//   3. Default → main

export type AgentName = "main" | "comms" | "content" | "ops" | "research";

const PREFIX = /^(main|comms|content|ops|research)\s*[:,\-]\s*/i;
const BROADCAST = /\b(everyone|team|status\s+update)\b/i;

export function routeMessage(text: string): { agent: AgentName; stripped: string } {
  const m = text.match(PREFIX);
  if (m) {
    return {
      agent: m[1].toLowerCase() as AgentName,
      stripped: text.slice(m[0].length),
    };
  }
  if (BROADCAST.test(text)) return { agent: "main", stripped: text };
  return { agent: "main", stripped: text };
}

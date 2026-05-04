// Outbound secret scanner. Block + audit any message containing likely
// credentials. Deliberately aggressive — false positives are fine, false
// negatives are not.

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "anthropic-key", re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: "openai-key", re: /sk-[a-zA-Z0-9]{32,}/ },
  { name: "google-api-key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "github-token", re: /gh[pous]_[0-9A-Za-z]{36,}/ },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "pem", re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "slack-token", re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
];

export interface ExfilHit {
  name: string;
  preview: string;
}

export function scan(text: string): ExfilHit[] {
  const hits: ExfilHit[] = [];
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ name, preview: m[0].slice(0, 8) + "…" });
  }
  return hits;
}

export function redact(text: string): string {
  let out = text;
  for (const { re } of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

// C3 — Audit log rotation.
// Rotate the file when it exceeds maxBytes; gzip it with a UTC datestamp.
// Keep the most recent `keep` rotations and delete older ones.

import { stat, rename, readdir, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { dirname, basename, join } from "node:path";
import { pipeline } from "node:stream/promises";

export async function rotateAuditIfLarge(
  filePath: string,
  maxBytes: number,
  keep: number,
): Promise<void> {
  let size: number;
  try {
    const s = await stat(filePath);
    size = s.size;
  } catch {
    return; // file doesn't exist yet — nothing to rotate
  }
  if (size < maxBytes) return;

  const dir = dirname(filePath);
  const base = basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedRaw = join(dir, `${base}.${stamp}`);
  const rotatedGz = `${rotatedRaw}.gz`;

  // Move current → timestamped raw, then compress.
  await rename(filePath, rotatedRaw);
  await pipeline(
    createReadStream(rotatedRaw),
    createGzip({ level: 9 }),
    createWriteStream(rotatedGz),
  );
  await unlink(rotatedRaw);

  // Prune older rotations beyond `keep`.
  const all = await readdir(dir);
  const rotations = all
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith(".gz"))
    .sort()
    .reverse(); // newest first
  for (const old of rotations.slice(keep)) {
    await unlink(join(dir, old)).catch(() => {});
  }
}

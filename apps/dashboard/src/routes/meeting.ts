// B1 — Daily.co meeting integration.
// Creates a one-shot Daily.co room; returns its URL.
// Pipecat extension joins separately via apps/warroom/meeting.py (server-side).
//
// POST /api/meeting/create  → { url, room_name, expires_at }
// GET  /api/meeting/list    → recent rooms (cached locally only — Daily owns truth)

import { Hono } from "hono";

const DAILY_API = "https://api.daily.co/v1";
const ROOM_TTL_SEC = 60 * 60;          // 1 hour — auto-expires

export default function meetingRoute() {
  const app = new Hono();

  app.post("/create", async (c) => {
    const key = process.env.DAILY_API_KEY;
    if (!key) {
      return c.json({
        error: "DAILY_API_KEY unset — set it in .env to enable meetings",
      }, 503);
    }
    const body = await c.req.json().catch(() => ({})) as { name?: string; agent?: string };
    const roomName = (body.name || `cc-${Date.now().toString(36)}`).slice(0, 40);
    const exp = Math.floor(Date.now() / 1000) + ROOM_TTL_SEC;

    const res = await fetch(`${DAILY_API}/rooms`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: roomName,
        privacy: "private",
        properties: {
          exp,
          enable_chat: true,
          enable_screenshare: true,
          enable_knocking: false,
          start_video_off: true,    // user starts muted; agent has no camera anyway
          start_audio_off: false,
          eject_at_room_exp: true,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      // Pass through 5xx as 502 (bad gateway) and others as 400.
      const status = res.status >= 500 ? 502 : 400;
      return c.json({ error: `daily.co ${res.status}: ${text.slice(0, 300)}` }, status);
    }
    const json = await res.json() as { name: string; url: string; config?: { exp?: number } };

    // Optionally signal the warroom Pipecat extension to join the room as the agent.
    // This is a best-effort POST to a local endpoint; if it fails, the user can
    // still join solo and use the chat to talk to themselves while we debug.
    if (process.env.WARROOM_INTERNAL_URL) {
      fetch(`${process.env.WARROOM_INTERNAL_URL}/join-meeting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: json.url, agent: body.agent ?? "main" }),
      }).catch(() => { /* non-fatal */ });
    }

    return c.json({
      url: json.url,
      room_name: json.name,
      expires_at: json.config?.exp ?? exp,
      agent: body.agent ?? "main",
    });
  });

  // Lightweight list — Daily.co's API supports listing but we don't cache here.
  app.get("/list", async (c) => {
    const key = process.env.DAILY_API_KEY;
    if (!key) return c.json({ rooms: [], note: "DAILY_API_KEY unset" });
    const res = await fetch(`${DAILY_API}/rooms?limit=20`, {
      headers: { "authorization": `Bearer ${key}` },
    });
    if (!res.ok) return c.json({ error: `daily.co ${res.status}` }, res.status >= 500 ? 502 : 400);
    const json = await res.json() as { data: Array<{ name: string; url: string; created_at: string; config: any }> };
    return c.json({
      rooms: json.data.map((r) => ({
        name: r.name,
        url: r.url,
        created_at: r.created_at,
        expires_at: r.config?.exp ?? null,
      })),
    });
  });

  return app;
}

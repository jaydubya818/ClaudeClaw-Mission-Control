# Daily.co setup (B1 — video meetings)

The `/api/meeting/create` endpoint and `/meeting` Telegram command both need a
Daily.co account + API key. Free tier covers 10K participant-minutes/month —
fine for personal use.

## 5-minute walkthrough

1. **Sign up** at https://dashboard.daily.co/signup with the email you use for
   ClaudeClaw. You'll get an `https://<you>.daily.co` subdomain.

2. **Get your API key**: https://dashboard.daily.co/developers
   Copy the value labeled "API key" (long random string).

3. **Add to `.env`** (already in `.env.example` template):
   ```bash
   DAILY_API_KEY=<paste-here>
   DAILY_DOMAIN=<your-subdomain>.daily.co       # optional; not currently used
   ```

4. **Restart the dashboard so it picks up the new env**:
   ```bash
   ./bin/restart.sh dashboard
   ```

5. **Verify it works**:
   ```bash
   # Should return a fresh Daily.co room URL valid for 1 hour
   curl -X POST http://localhost:3141/api/meeting/create \
        -H 'content-type: application/json' \
        -d '{"agent": "main"}'
   ```

   You should see something like:
   ```json
   {
     "url": "https://yoursubdomain.daily.co/cc-abc123",
     "room_name": "cc-abc123",
     "expires_at": 1733251200,
     "agent": "main"
   }
   ```

6. **Test from Telegram**: send `/meeting main` → returns the room URL.
   Click it on your phone → join the call.

## Optional: agent joins the meeting

For the agent to actually appear in the room (Pipecat → Daily transport →
Gemini Live), start the Meetings service:

```bash
./bin/restart.sh meeting        # local Pipecat extension on :7861
```

Requires `pipecat-ai[daily,gemini]` installed in `apps/warroom/.venv`. The
`apps/warroom/meeting.py` module guards itself with `HAVE_PIPECAT` so the
endpoint stays useful (returns the room URL) even when Pipecat isn't set up
— you can join solo and use Daily.co's chat to talk to yourself while we
debug the agent side.

## Cost guardrails (recommended)

Set both before enabling Pika avatars:

```bash
PIKA_ENABLED=false                # default; flip to true only when you're ready
PIKA_DAILY_USD_CAP=5              # auto-disable if today's spend > $5
```

Daily.co itself is essentially free at personal scale — it's the optional
Pika video avatar that's "eyewateringly expensive" (transcript ch.5).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `503 DAILY_API_KEY unset` | env not loaded into dashboard process | restart dashboard via `./bin/restart.sh dashboard` |
| `daily.co 401: invalid token` | wrong key or expired | regenerate at https://dashboard.daily.co/developers |
| `/meeting` Telegram cmd 404s | bridge process is using old code | `./bin/restart.sh bridge` |
| Room URL works but agent doesn't appear | Pipecat not installed / Meetings service offline | install deps + `./bin/restart.sh meeting`, OR use room solo |
| Sidebar shows "Meetings :7861 ● offline" indefinitely | Pipecat extension never started | not blocking — only the agent-joins-room flow needs it |

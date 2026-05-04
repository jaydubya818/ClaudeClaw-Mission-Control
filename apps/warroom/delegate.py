"""
Delegation bridge — when the War Room pipeline detects a "delegate" intent
in transcribed speech, this module spawns a sub-agent task by POSTing to the
bridge's loopback enqueue endpoint. The bridge then runs it through the SDK
and delivers the result via Telegram (and hive_mind).
"""

import os
import re
from urllib import request, parse

BRIDGE_URL = os.environ.get(
    "BRIDGE_INTERNAL_URL", "http://127.0.0.1:3142/enqueue"
)
CHAT_ID = os.environ.get("TELEGRAM_DEFAULT_CHAT_ID", "")

# Matches: "Comms, draft a script …" / "Tell Ops to pull last month's expenses"
EXPLICIT_RE = re.compile(
    r"\b(main|comms|content|ops|research)[,:]?\s*(?:please\s+)?(.+)$",
    re.I | re.S,
)
TELL_RE = re.compile(
    r"\btell\s+(main|comms|content|ops|research)\s+to\s+(.+)$",
    re.I | re.S,
)


def parse_delegation(text: str) -> tuple[str, str] | None:
    m = TELL_RE.search(text) or EXPLICIT_RE.search(text.strip())
    if not m:
        return None
    return m.group(1).lower(), m.group(2).strip()


def spawn(agent: str, task: str, chat_id: str | None = None) -> bool:
    target = chat_id or CHAT_ID
    if not target:
        return False
    body = parse.urlencode({}).encode()  # not used; we send JSON below
    import json as _json

    req = request.Request(
        BRIDGE_URL,
        data=_json.dumps({"chatId": target, "text": f"{agent}: {task}"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f"[delegate] spawn failed: {e}")
        return False

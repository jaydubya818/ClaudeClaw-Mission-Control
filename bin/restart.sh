#!/usr/bin/env bash
# ClaudeClaw service restart helper.
# Cleanly stops a service (whether launchd-managed or manual `npm run dev`)
# and brings it back up. After restart, polls health to confirm.
#
# Usage:
#   ./bin/restart.sh dashboard       # restart just the dashboard
#   ./bin/restart.sh bridge
#   ./bin/restart.sh warroom
#   ./bin/restart.sh scheduler
#   ./bin/restart.sh consolidator
#   ./bin/restart.sh meeting         # warroom Daily.co bridge
#   ./bin/restart.sh all             # restart every service
#   ./bin/restart.sh status          # just print status
#
# Modes (env override):
#   MODE=launchd    use launchd plists from infra/launchd/  (production)
#   MODE=dev        use `npm run dev` / venv python  (live-reload, default)

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${MODE:-dev}"
LOG_DIR="$HOME/Library/Logs/claudeclaw"
mkdir -p "$LOG_DIR"

# service → (pkill_pattern, port, dev_cmd, dev_cwd)
declare -a SERVICES=(bridge dashboard warroom scheduler consolidator meeting decay)

pattern_for() {
  case "$1" in
    bridge)        echo "tsx.*bridge/src/index" ;;
    dashboard)     echo "tsx.*dashboard/src/server" ;;
    warroom)       echo "warroom/server.py" ;;
    meeting)       echo "warroom/meeting.py" ;;
    scheduler)     echo "tsx.*scheduler/runner" ;;
    consolidator)  echo "memory.consolidator\|memory/consolidator.py" ;;
    decay)         echo "memory.decay\|memory/decay.py" ;;
    *)             echo "" ;;
  esac
}

port_for() {
  case "$1" in
    bridge)     echo 3142 ;;
    dashboard)  echo 3141 ;;
    warroom)    echo 7860 ;;
    meeting)    echo 7861 ;;
    *)          echo "" ;;
  esac
}

dev_cmd_for() {
  # Prints "cwd|cmd". Some services don't have a dev mode.
  case "$1" in
    bridge)        echo "$REPO/apps/bridge|npm run dev" ;;
    dashboard)     echo "$REPO/apps/dashboard|npm run dev" ;;
    warroom)       echo "$REPO/apps/warroom|.venv/bin/python server.py" ;;
    meeting)       echo "$REPO/apps/warroom|.venv/bin/python meeting.py" ;;
    scheduler)     echo "$REPO|node --import=tsx scheduler/runner.ts" ;;
    consolidator)  echo "$REPO|.venv/bin/python -m memory.consolidator" ;;
    decay)         echo "$REPO|.venv/bin/python -m memory.decay" ;;
    *)             echo "" ;;
  esac
}

stop_service() {
  local svc="$1"
  local pat="$(pattern_for "$svc")"
  local port="$(port_for "$svc")"
  echo "  → stopping $svc"
  # 1. Try launchd bootout (idempotent — exits 0 if not loaded)
  launchctl bootout "gui/$(id -u)/com.claudeclaw.$svc" 2>/dev/null || true
  # 2. pkill any manual dev process
  if [ -n "$pat" ]; then
    pkill -f "$pat" 2>/dev/null || true
    sleep 0.5
    # SIGKILL if still alive
    pkill -9 -f "$pat" 2>/dev/null || true
  fi
  # 3. Free the port — nuke anyone still listening (handles zombies / old tsx workers)
  if [ -n "$port" ] && command -v lsof >/dev/null 2>&1; then
    local pids="$(lsof -ti tcp:$port 2>/dev/null | tr '\n' ' ')"
    if [ -n "$pids" ]; then
      echo "    killing PIDs on :$port: $pids"
      kill -9 $pids 2>/dev/null || true
    fi
  fi
  sleep 0.5
}

start_service() {
  local svc="$1"
  if [ "$MODE" = "launchd" ]; then
    local plist="$REPO/infra/launchd/com.claudeclaw.$svc.plist"
    if [ -f "$plist" ]; then
      cp "$plist" "$HOME/Library/LaunchAgents/"
      launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.claudeclaw.$svc.plist" \
        2>&1 | sed "s/^/    launchd: /"
    else
      echo "  ✗ no plist: $plist"
      return 1
    fi
  else
    # dev mode — npm run dev in background, log to stable path
    local spec="$(dev_cmd_for "$svc")"
    [ -z "$spec" ] && { echo "  ✗ no dev cmd for $svc"; return 1; }
    local cwd="${spec%%|*}"
    local cmd="${spec##*|}"
    [ -d "$cwd" ] || { echo "  ✗ cwd missing: $cwd"; return 1; }
    local log="$LOG_DIR/$svc.dev.log"
    (
      cd "$cwd"
      # Load .env so the process picks up GEMINI_API_KEY etc.
      [ -f "$REPO/.env" ] && set -a && . "$REPO/.env" && set +a
      nohup bash -c "$cmd" > "$log" 2>&1 &
      disown
    )
    echo "  → started $svc (logs: $log)"
  fi
}

health() {
  local svc="$1"
  local port="$(port_for "$svc")"
  if [ -z "$port" ]; then
    pgrep -f "$(pattern_for "$svc")" >/dev/null 2>&1 \
      && echo "online (pid $(pgrep -f "$(pattern_for "$svc")" | head -1))" \
      || echo "offline"
    return
  fi
  for i in 1 2 3 4 5 6; do
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then echo "online (:$port)"; return; fi
    sleep 0.7
  done
  echo "offline (:$port — timeout)"
}

restart_one() {
  local svc="$1"
  echo "» $svc"
  stop_service "$svc"
  start_service "$svc"
  printf "  health: "
  health "$svc"
}

status_all() {
  echo "ClaudeClaw service status (mode=$MODE)"
  printf "%-14s %-30s %s\n" "SERVICE" "PROCESS" "PORT"
  for s in "${SERVICES[@]}"; do
    local pid=$(pgrep -f "$(pattern_for "$s")" 2>/dev/null | head -1)
    local proc_state="${pid:-—}"
    local port_state="$(health "$s")"
    printf "%-14s %-30s %s\n" "$s" "$proc_state" "$port_state"
  done
}

case "${1:-status}" in
  status)
    status_all
    ;;
  all)
    for s in "${SERVICES[@]}"; do restart_one "$s"; done
    echo ""
    status_all
    ;;
  bridge|dashboard|warroom|scheduler|consolidator|meeting|decay)
    restart_one "$1"
    ;;
  *)
    echo "Usage: $0 {status | all | bridge | dashboard | warroom | scheduler | consolidator | meeting | decay}"
    echo "Env:    MODE=launchd|dev  (default: dev)"
    exit 1
    ;;
esac

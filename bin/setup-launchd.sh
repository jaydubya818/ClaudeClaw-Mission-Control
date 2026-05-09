#!/usr/bin/env bash
# One-shot: install all 7 plists into ~/Library/LaunchAgents and bootstrap
# them under launchd so everything auto-boots when the Mac wakes.
#
# Usage:
#   ./bin/setup-launchd.sh              # install + bootstrap all
#   ./bin/setup-launchd.sh status       # just print status
#   ./bin/setup-launchd.sh uninstall    # bootout + remove from LaunchAgents

set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
USER_AGENTS="$HOME/Library/LaunchAgents"
UID_=$(id -u)
LOG_DIR="$HOME/Library/Logs/claudeclaw"

SERVICES=(bridge dashboard warroom scheduler consolidator backup decay)

mkdir -p "$LOG_DIR" "$USER_AGENTS"

cmd="${1:-install}"

install_one() {
  local svc="$1"
  local src="$REPO/infra/launchd/com.claudeclaw.$svc.plist"
  local dst="$USER_AGENTS/com.claudeclaw.$svc.plist"
  if [ ! -f "$src" ]; then
    echo "  ✗ $svc: plist missing ($src)"
    return 1
  fi
  echo "  → $svc"
  # Aggressive cleanup: bootout, kill any process matching the service, wait.
  launchctl bootout "gui/$UID_/com.claudeclaw.$svc" 2>/dev/null || true
  launchctl remove "com.claudeclaw.$svc" 2>/dev/null || true
  case "$svc" in
    bridge)        pkill -f "tsx.*bridge/src/index"     2>/dev/null || true ;;
    dashboard)     pkill -f "tsx.*dashboard/src/server" 2>/dev/null || true ;;
    warroom)       pkill -f "warroom/server.py"          2>/dev/null || true ;;
    meeting)       pkill -f "warroom/meeting.py"         2>/dev/null || true ;;
    scheduler)     pkill -f "tsx.*scheduler/runner"     2>/dev/null || true ;;
    consolidator)  pkill -f "memory.consolidator"        2>/dev/null || true ;;
  esac
  sleep 1

  # Copy fresh plist
  cp "$src" "$dst"

  # Bootstrap with a single retry on Input/output error (race condition on bootout)
  local attempt=1 max_attempts=3
  while [ $attempt -le $max_attempts ]; do
    local out
    out=$(launchctl bootstrap "gui/$UID_" "$dst" 2>&1)
    if [ $? -eq 0 ] && [ -z "$out" ]; then
      break
    fi
    if echo "$out" | grep -qi "Input/output error\|Bootstrap failed"; then
      [ $attempt -lt $max_attempts ] && {
        echo "    retry $((attempt+1))/$max_attempts after I/O error..."
        launchctl bootout "gui/$UID_/com.claudeclaw.$svc" 2>/dev/null || true
        sleep 2
      } || echo "$out" | sed "s/^/    /"
    else
      echo "$out" | sed "s/^/    /"
      break
    fi
    attempt=$((attempt + 1))
  done

  # Wait briefly then check status
  sleep 2
  if launchctl print "gui/$UID_/com.claudeclaw.$svc" >/dev/null 2>&1; then
    local entry
    entry=$(launchctl list | grep "com.claudeclaw.$svc")
    local pid=$(echo "$entry" | awk '{print $1}')
    local exit_code=$(echo "$entry" | awk '{print $2}')
    if [ "$pid" != "-" ]; then
      echo "    ✓ loaded (pid=$pid)"
    elif [ "$exit_code" = "0" ]; then
      echo "    ✓ loaded (idle — runs on schedule)"
    else
      echo "    ⚠ loaded but exited code=$exit_code (check ~/Library/Logs/claudeclaw/$svc.err)"
    fi
  else
    echo "    ✗ failed to load"
  fi
}

uninstall_one() {
  local svc="$1"
  echo "  → $svc"
  launchctl bootout "gui/$UID_/com.claudeclaw.$svc" 2>/dev/null && echo "    ✓ booted out" || echo "    (was not loaded)"
  rm -f "$USER_AGENTS/com.claudeclaw.$svc.plist"
}

case "$cmd" in
  install)
    echo "Installing 7 ClaudeClaw services to launchd..."
    echo ""
    # Pre-flight: kill manual processes so launchd has a clean port to bind.
    echo "Killing any manual dev processes first..."
    pkill -f "tsx.*dashboard/src/server" 2>/dev/null || true
    pkill -f "tsx.*bridge/src/index"     2>/dev/null || true
    pkill -f "warroom/server.py"          2>/dev/null || true
    pkill -f "scheduler/runner"           2>/dev/null || true
    sleep 1
    echo ""
    for svc in "${SERVICES[@]}"; do
      install_one "$svc"
    done
    echo ""
    echo "Done. Verify with: $0 status"
    echo "Tail logs:        tail -f $LOG_DIR/*.err"
    ;;
  uninstall)
    for svc in "${SERVICES[@]}"; do
      uninstall_one "$svc"
    done
    ;;
  status)
    echo "ClaudeClaw services in launchd:"
    launchctl list | grep claudeclaw || echo "  (none loaded)"
    ;;
  *)
    echo "Usage: $0 [install | status | uninstall]"
    exit 1
    ;;
esac

#!/usr/bin/env bash
# ClaudeClaw V3 → GitHub deployment script.
# Run from your Mac Terminal (NOT from a Cowork/Claude sandbox session) where
# your GitHub auth is already configured (gh CLI, SSH keys, or HTTPS PAT).
#
# Usage: ./deploy.sh [commit_message]
#
# Idempotent: re-runs cleanly if you change files and want to push again.

set -euo pipefail

REPO_URL="https://github.com/jaydubya818/ClaudeClaw-Mission-Control.git"
DEFAULT_MSG="ClaudeClaw V3 — Mission Control update"
COMMIT_MSG="${1:-$DEFAULT_MSG}"

cd "$(dirname "$0")"
echo "==> deploying from: $(pwd)"

# Heal sandbox-orphaned .git directory if present (cannot be modified inside
# Cowork sandbox due to mount perms; your Mac filesystem has full perms).
if [ -d .git ] && ! git status >/dev/null 2>&1; then
  echo "==> .git exists but is broken (likely sandbox orphan); rebuilding"
  rm -rf .git
fi

# Init repo if not already a git repo.
if [ ! -d .git ]; then
  echo "==> git init"
  git init -q
  git checkout -q -b main 2>/dev/null || git checkout -q main
fi

# Configure local identity if not set.
git config user.name >/dev/null 2>&1  || git config user.name  "Jay West"
git config user.email >/dev/null 2>&1 || git config user.email "jaydubya818@gmail.com"

# Remove any stale lockfile from prior sandbox runs.
rm -f .git/index.lock

# Wire up remote (idempotent).
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi
echo "==> remote origin = $(git remote get-url origin)"

# Sanity: don't push secrets. Verify .env is gitignored.
if git check-ignore -q .env; then
  echo "==> .env is gitignored ✓"
else
  echo "!! WARNING: .env is NOT gitignored. Aborting."
  exit 1
fi

# Stage + commit if there's anything to commit.
git add -A
if git diff --cached --quiet; then
  echo "==> nothing to commit (working tree matches HEAD)"
else
  echo "==> committing: $COMMIT_MSG"
  git commit -q -m "$COMMIT_MSG"
fi

# Push. First push uses -u to set upstream.
echo "==> pushing to $REPO_URL (branch: main)"
if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
  git push origin main
else
  git push -u origin main
fi

echo ""
echo "==> done."
echo "    https://github.com/jaydubya818/ClaudeClaw-Mission-Control"

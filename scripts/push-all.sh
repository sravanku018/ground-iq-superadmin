#!/usr/bin/env bash
# Push the current branch HEAD to `main` on BOTH repos at once:
#   ground-iq            → https://github.com/sravanku018/ground-iq-web.git
#   ground-iq-superadmin → https://github.com/sravanku018/ground-iq-superadmin.git
#
# Usage:
#   bash scripts/push-all.sh            # push current HEAD to both mains
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_REMOTE="ground-iq"
SUPER_REMOTE="ground-iq-superadmin"

# 1. Refuse to push a dirty tree (uncommitted changes never leave this machine)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "!! Working tree has uncommitted changes — commit or stash them first." >&2
  exit 1
fi

HEAD_BRANCH="$(git symbolic-ref --short HEAD)"
HEAD_SHA="$(git rev-parse --short HEAD)"
echo "Pushing $HEAD_BRANCH ($HEAD_SHA) -> main on both remotes..."

# 2. Web repo first (source of truth); abort if it fails
git push "$WEB_REMOTE" HEAD:main

# 3. Super admin mirror
git push "$SUPER_REMOTE" HEAD:main

echo ""
echo "Done: $HEAD_SHA pushed to ground-iq-web and ground-iq-superadmin."

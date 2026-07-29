#!/usr/bin/env bash
# One-command deploy for the Mac Mini:
#   ~/consciousness-gateway/deploy/redeploy.sh
#
# Discards local lockfile drift, fast-forwards to origin, installs exactly
# from the lockfile (npm ci never rewrites it, so the next pull can't be
# blocked by it), builds, and only restarts the service if the build
# succeeded — a failed build must never kickstart stale JS.
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE_LABEL="${GATEWAY_SERVICE_LABEL:-com.alignconscious.gateway}"

echo "== discarding local package-lock drift (if any) =="
git checkout -- package-lock.json 2>/dev/null || true

echo "== pulling =="
git pull --ff-only

echo "== installing from lockfile (npm ci) =="
npm ci

echo "== building =="
npm run build

echo "== restarting ${SERVICE_LABEL} =="
launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}"

sleep 3
echo "== verifying =="
curl -s http://127.0.0.1:3000/v1/models | head -c 400
echo
echo "== done =="

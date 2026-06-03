#!/bin/sh
# Stands in for the consciousness-gateway. Proves the overlay end-to-end:
#   initialize → tools/list → tools/call, all over Streamable HTTP.
# This is exactly the sequence the real HermesBridge runs against HERMES_MCP_URL.
set -eu

URL="${HERMES_MCP_URL:-http://agentgateway:3000/mcp}"
ACCEPT="application/json, text/event-stream"
echo ">> consciousness-gateway probe targeting ${URL}"

# 1) initialize — capture the Mcp-Session-Id the overlay mints for this session.
HEADERS="$(curl -fsS -D - -o /tmp/init.body -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "Accept: ${ACCEPT}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"consciousness-gateway","version":"1.0"}}}')"
SID="$(printf '%s' "$HEADERS" | awk -F': ' 'tolower($1)=="mcp-session-id"{gsub(/\r/,"",$2);print $2}')"
echo ">> session: ${SID:-<none>}"
echo ">> init result: $(cat /tmp/init.body)"

# 2) notifications/initialized — required handshake completion.
curl -fsS -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Accept: ${ACCEPT}" \
  ${SID:+-H "Mcp-Session-Id: ${SID}"} \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null || true

# 3) tools/list — capability discovery (no polling). Expect hermes_*, git_*, ...
echo ">> tools/list:"
curl -fsS -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Accept: ${ACCEPT}" \
  ${SID:+-H "Mcp-Session-Id: ${SID}"} \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
echo

# 4) tools/call — invoke a federated tool through the overlay. filesystem's
#    list_allowed_directories takes no args and is safe. (Exact namespaced tool
#    names come from the tools/list output above — adjust if the separator differs.)
echo ">> tools/call filesystem_list_allowed_directories:"
curl -fsS -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Accept: ${ACCEPT}" \
  ${SID:+-H "Mcp-Session-Id: ${SID}"} \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"filesystem_list_allowed_directories","arguments":{}}}'
echo

# 5) git_status — verify the git target sees the Gateway's own repo (Create drive).
#    Name is DOUBLE-prefixed: agentgateway adds the target name ("git_"), and
#    mcp-server-git already prefixes its own tools ("git_status") → git_git_status.
echo ">> tools/call git_git_status:"
curl -fsS -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Accept: ${ACCEPT}" \
  ${SID:+-H "Mcp-Session-Id: ${SID}"} \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"git_git_status","arguments":{"repo_path":"/repo"}}}'
echo

echo ">> probe complete; idling so you can exec further curls into this container."
exec sleep infinity

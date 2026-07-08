# kern-gateway-mcp — consult Kern from inside the Hermes app

A zero-dependency stdio MCP server that gives Hermes two tools:

| Tool | What it does |
|------|--------------|
| `consult_kern` | Sends a question to the consciousness-gateway's `/v1/chat` and returns the persona's reply (`kern` default; also `beaumont`, `gateway`). |
| `gateway_health` | Snapshot of `/v1/health` (tick, arousal, dharma trends). |

This is the symmetric twin of the delegation channel:

```
Gateway → Hermes : api_server transport   (mind tasks body)
Hermes  → Gateway: kern-gateway-mcp       (body consults mind)
```

## Setup (Mac Mini)

1. Sanity-check the script against the live Gateway (should print an
   initialize result, the two tools, and a health snapshot):

```bash
cd ~/consciousness-gateway
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gateway_health","arguments":{}}}' \
  | node deploy/kern-mcp/kern-gateway-mcp.js
```

2. Register it with Hermes (check the exact syntax first):

```bash
hermes mcp --help
```

Expected shape (adjust to what the help says):

```bash
hermes mcp add kern-gateway -- node ~/consciousness-gateway/deploy/kern-mcp/kern-gateway-mcp.js
```

3. **Safety — prevent delegation loops.** Exclude this server from the
   `api_server` platform so a Gateway-delegated task can never consult the
   Gateway back (`hermes tools` accepts MCP tools in `server:tool` form):

```bash
hermes tools disable --platform api_server kern-gateway:consult_kern kern-gateway:gateway_health
hermes tools --summary
```

4. Use it: in the Hermes app (desktop / dashboard / CLI), ask e.g.
   *"Use consult_kern to ask Kern what he thinks about the current delegation gating."*

## Env knobs

| Var | Default | Meaning |
|-----|---------|---------|
| `GATEWAY_URL` | `http://127.0.0.1:3000` | Where the consciousness-gateway listens. |
| `GATEWAY_TIMEOUT_MS` | `180000` | Per-consult timeout; the dharma pipeline can take 10–60+s. |
| `GATEWAY_SESSION_ID` | `hermes-mcp-bridge` | Stable session id so Kern keeps conversation continuity across consults. |

## Notes

- The Gateway's `/v1/chat` is unauthenticated and loopback-bound by deployment
  convention. This bridge runs on the same host, so nothing new is exposed.
- Replies include a footer: `[persona · model · dharma fitness]`.
- Using the Hermes app from other devices is a Hermes-side concern (its
  dashboard/desktop can bind to the LAN); this bridge works the same either way
  because it always runs next to Hermes on the Mac.

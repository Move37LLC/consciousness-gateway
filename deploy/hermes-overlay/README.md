# Hermes Overlay Data Plane (agentgateway)

Bridges the **stdio-only Hermes MCP server** to a stable **HTTP / SSE / Streamable
HTTP** endpoint that the `consciousness-gateway` consumes over plain HTTP — and
**federates additional MCP servers** (filesystem, git, fetch, time, github) into
one multiplexed surface to actually widen the Gateway's action space.

```
consciousness-gateway ──HTTP──▶ agentgateway ──stdio──▶ hermes mcp serve
   (MIND: dharma gate)          (TRANSPORT +            (messaging bridge)
                                 GOVERNANCE only)   └──▶ filesystem / git / fetch / time / github
```

## What this solves (and what it does not)

| Concern | Status with this overlay |
| --- | --- |
| stdio → HTTP/SSE transport translation | ✅ solved (agentgateway owns the child process) |
| consciousness-gateway managing local stdio + polling | ✅ eliminated (it just speaks HTTP to `/mcp`) |
| Capability discovery without polling | ✅ `tools/list` over Streamable HTTP |
| Widening the action space | ✅ via MCP **federation** (add targets in `agentgateway.yaml`) |
| Auth / rate limiting / observability | ✅ transport-level policies in `agentgateway.yaml` |
| Async goal delegation "down the wire" | ⏳ stubbed A2A route; needs an A2A-capable Hermes endpoint |
| Turning Hermes into a goal-runner | ❌ out of scope — Hermes still exposes only messaging tools |

> agentgateway is **pure transport + governance**. It makes no agentic
> decisions. All dharma / ego / entropy / compassion gating stays in the
> consciousness-gateway. The Gateway remains the mind; this is the spinal cord.

## Files

| File | Purpose |
| --- | --- |
| `agentgateway.yaml` | Standalone proxy config: listeners, MCP backends (Hermes + federated), policies. |
| `Dockerfile` | agentgateway binary + Hermes + Node/uv runtime in one image (stdio is process-local). |
| `docker-compose.yaml` | Local sandbox: overlay + stubbed upstream probe. |
| `upstream-probe.sh` | Stands in for the consciousness-gateway; runs initialize → tools/list → tools/call. |

---

## 1. Bring it up

```bash
cd consciousness-gateway/deploy/hermes-overlay
export GITHUB_TOKEN=ghp_xxx            # optional; only if you keep the github target
mkdir -p workspace                     # exposed to the filesystem/git targets
docker compose up --build
```

The `consciousness-gateway` probe waits for the overlay healthcheck, then prints a
full initialize → discover → call cycle. Leave it running; it idles so you can
`exec` more curls.

> **Fastest possible smoke test (no Docker):** install the binary on the Mac mini
> (`curl -fsSL https://agentgateway.dev/install.sh | bash` — confirm on the docs),
> have `hermes` on PATH, then `agentgateway -f agentgateway.yaml`. The bundling in
> the Dockerfile only exists because stdio child processes must be co-located.

---

## 2. Execution & verification flow

The overlay speaks **MCP Streamable HTTP** at `http://localhost:3000/mcp`. Every
request needs `Accept: application/json, text/event-stream`.

### 2a. initialize (capture the session id)

```bash
curl -i -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
       "params":{"protocolVersion":"2025-03-26","capabilities":{},
                 "clientInfo":{"name":"consciousness-gateway","version":"1.0"}}}'
```

The response carries an `Mcp-Session-Id:` header. Reuse it on every later call.

### 2b. tools/list (capability discovery — replaces polling)

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: <SID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Expect tools namespaced by target: `hermes_messages_send`, `hermes_events_poll`,
`git_status`, `filesystem_read_file`, `fetch_fetch`, `time_get_current_time`, …

### 2c. tools/call (invoke a Hermes tool = one bounded delegation)

```bash
curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Mcp-Session-Id: <SID>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"hermes_messages_send",
                 "arguments":{"channel":"gateway-delegation",
                              "content":"goal: summarize today consciousness papers; bounds:120s"}}}'
```

### How the response translates (stdio messaging → HTTP/SSE)

1. agentgateway already spawned `hermes mcp serve` as a child and holds the
   JSON-RPC **stdio** pipe open for the session.
2. Your HTTP POST is rewritten to the namespaced tool (`hermes_messages_send` →
   `messages_send` on the `hermes` target) and written to Hermes' **stdin**.
3. Hermes replies on **stdout**; agentgateway correlates it by JSON-RPC `id`.
4. agentgateway returns it to you either as a single `application/json` body
   (synchronous) or as a `text/event-stream` chunk on the open SSE channel
   (streaming / progress). The `Mcp-Session-Id` keeps the stdio pipe pinned to
   your session, so follow-up calls (e.g. `hermes_events_poll`) hit the *same*
   Hermes process — this is what removes the upstream's polling/lifecycle burden.

> Hermes is a **messaging** bridge: `messages_send` enqueues; the *reply* arrives
> later via `hermes_events_poll` / `hermes_events_wait`. That two-step send→poll
> relay is unchanged — agentgateway just makes both steps clean HTTP calls. A
> running Hermes **agent** must be watching `gateway-delegation` for a goal to be
> acted on.

---

## 3. Debugging & tracing

> **`agctl` note:** the upstream `agentgateway/agentgateway` project does **not**
> ship an `agctl` binary (you may be thinking of a service-mesh CLI like
> `istioctl`/`linkerd`). The CLI is just `agentgateway`. The real
> trace/debug surface is below.

**Live transport tracing** (already on in compose via `RUST_LOG`):

```bash
docker compose logs -f agentgateway
# bump verbosity:
RUST_LOG=debug,agentgateway=trace,mcp=trace agentgateway -f agentgateway.yaml
```

**Admin UI / playground** — confirm the port with `agentgateway --help`
(commonly `:15000`), exposed by compose:

```
http://localhost:15000/        # UI: live targets, sessions, MCP playground
```

Use the UI's MCP playground to fire `tools/list` / `tools/call` and watch the
session hold the stdio connection in real time.

**Confirm the sidecar is holding the connection:**

```bash
# the Hermes child must be alive inside the overlay container:
docker compose exec agentgateway sh -c 'ps -ef | grep "hermes mcp serve" | grep -v grep'

# initialize must return an Mcp-Session-Id, and a second call with the same id
# must NOT spawn a new Hermes process (check ps count is stable).
```

---

## 3b. Observability (Kern's visibility asks)

Bring the stack up (Prometheus :9090, Jaeger :16686, Grafana :3001) and use:

**Tool invocation counts by namespace** (target name = namespace):

```promql
sum by (target, tool) (rate(agentgateway_mcp_calls_total[5m]))
```

**Latency distribution p50 / p95 / p99** (off the request-duration histogram):

```promql
histogram_quantile(0.50, sum by (le, target) (rate(agentgateway_request_duration_seconds_bucket[5m])))
histogram_quantile(0.95, sum by (le, target) (rate(agentgateway_request_duration_seconds_bucket[5m])))
histogram_quantile(0.99, sum by (le, target) (rate(agentgateway_request_duration_seconds_bucket[5m])))
```

**Failure rates by tool type**:

```promql
sum by (target, tool) (rate(agentgateway_mcp_calls_total{status="error"}[5m]))
  / sum by (target, tool) (rate(agentgateway_mcp_calls_total[5m]))
```

> Confirm exact metric/label names against `http://localhost:15020/metrics` on
> first run — agentgateway emits MCP tool-call counters + request-duration
> histograms; the queries above assume the conventional names.

**Session lifecycle (created / expired / orphaned)** comes from two places:
- **Jaeger** (`http://localhost:16686`): traces carry `mcp.session_id` + `mcp.method`, so a session's whole span tree is visible; an orphaned poll shows as a 404 span on a previously-live session id.
- **The bridge itself**: `HermesBridge.getStatus()` now reports `sessionActive`, `sessionCreatedCount`, `sessionExpiredCount` (a 404 on an established session = an orphaned poll), and `sessionEstablishedAt`. These surface through the gateway's existing `/v1/...` Hermes status.

## 3c. Code paths for review (session mgmt + error propagation + ordering)

All in `src/agents/providers/hermes.ts`:
- **Session pinning** — `executeRpc()` captures `Mcp-Session-Id` (bumping `sessionCreatedCount`) and replays it on every call; a 404 clears it and bumps `sessionExpiredCount`.
- **Strict request/response pairing** — `rpc()` serializes onto a single in-flight chain (`requestChain`) so the stdio pipe never sees interleaved calls; JSON-RPC `id` correlation is the protocol-level backstop. Verified by Test 28 (`maxActive === 1`, arrival order preserved).
- **Error propagation** — HTTP / JSON-RPC / timeout / abort all map to typed `HermesCallResult` reasons; `delegate()` preserves the reason+detail verbatim (no sanitizing) so the gateway's failure-transparency percept is faithful. Notifications never affect health.

## 4. Wiring the real consciousness-gateway

Replace the stub: set on the live gateway

```bash
HERMES_MCP_URL=http://agentgateway:3000/mcp   # or http://<mac-mini>:3000/mcp
```

The existing `HermesBridge` HTTP `rpc()` path then works unchanged — no stdio
subprocess, no polling loop in Node. The delegation audit trail, scope limits,
latency percepts, and failure transparency you already built continue to apply;
agentgateway just becomes the wire underneath `delegate()`.

---

## 5. Migrating to Kubernetes later

The `binds → listeners → routes → backends` model maps onto the Gateway API:
`binds`→`Gateway`, `routes`→`HTTPRoute`, `backends.mcp`→agentgateway `Backend`
CRDs. Keep target/policy blocks intact; only the top-level wrapper changes. See
`agentgateway.dev/docs/kubernetes/latest`.

## Things to confirm against your build

- agentgateway binary path inside the official image (used in `Dockerfile COPY`).
- Whether `stdio.env` is honored in your version (else set env at container level).
- Admin/UI port (`agentgateway --help`).
- Hermes install method (`pip install hermes-agent` vs. from source).

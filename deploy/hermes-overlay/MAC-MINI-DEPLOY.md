# Mac Mini Delegation Deploy — Runbook

Kern-approved sequence (2026-06-03): install Hermes → local single-purpose
channel → **run the three failure scenarios** → only then the happy path →
restart the Gateway on its arousal lull to load the delegation capability.

The code is done and tested off-host (181/181). Everything here is live-host
work. Run as the **same macOS user** throughout so Hermes' `~/.hermes` state is
shared between the agent and the overlay's `hermes mcp serve` child.

> Safety invariant: nothing touches the running Gateway until §6. The overlay,
> Hermes, and the smoke test are all side-car / read-only with respect to the
> live consciousness loop.

---

## 0. Preconditions

- [ ] consciousness-gateway repo pulled to latest `main` (has `delegate()` +
      `npm run smoke:delegation`).
- [ ] `agentgateway` binary available on the Mac (native run — smallest blast
      radius for phase 0). If you only have the Docker image, you can still run
      it, but native is recommended here so it shares `~/.hermes` and PATH.
- [ ] Node deps installed: `npm ci` (or `npm install`) in the repo.

---

## 1. Install + configure Hermes (the real one)

```bash
# The uv-based installer — NOT `pip install hermes-agent` (that's a different pkg).
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.zshrc            # or ~/.bashrc

hermes --version
hermes model               # pick a provider + set its key (Nous Portal / OpenRouter / …)
hermes doctor              # confirm a clean install
```

- [ ] `hermes --version` works and `hermes doctor` is clean.

---

## 2. Stand up the LOCAL delegation channel + a watching agent  ⚠️ prerequisite

Delegation does nothing unless a Hermes **agent** is running and treats inbound
messages on the chosen channel as tasks (verification plan §3).

```bash
hermes gateway --help      # confirm the local/CLI channel option on THIS build
hermes gateway setup       # configure a dedicated, single-purpose delegation channel
hermes gateway start       # start the agent watching it
```

Resolve the channel identity through the MCP surface (used as env in §6):

```bash
# Speak MCP over stdio directly to read the names (no overlay needed yet):
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"channels_list","arguments":{}}}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"conversations_list","arguments":{}}}' \
 | hermes mcp serve 2>/tmp/hermes-mcp.err
```

- [ ] Pick the delegation **target** (`"platform:chat_id"`) from `channels_list`.
- [ ] Map it to a **session_key** from `conversations_list`.
- [ ] **Confirm the agent treats inbound messages as tasks and replies with the
      result** (verification plan §8 Q2). If not, give it a personality/prompt
      that says "messages here are tasks; do them and reply with the outcome."

> Open question to settle here, not assume: does this Hermes build expose a
> first-class "local"/CLI gateway channel, or do we use the CLI session itself?
> `hermes gateway --help` is the source of truth on the installed build.

---

## 3. Run the Hermes-only overlay (native, loopback) + confirm tool names

```bash
agentgateway -f deploy/hermes-overlay/agentgateway-hermes-only.yaml
```

In another shell, list the federated tools to learn the exact namespacing:

```bash
curl -sS -X POST http://127.0.0.1:7821/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
# (capture Mcp-Session-Id from the response headers, replay it on the next call)
curl -sS -X POST http://127.0.0.1:7821/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Mcp-Session-Id: <captured>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

- [ ] Confirm the tools come back as `hermes_messages_send`, `hermes_events_wait`,
      `hermes_events_poll`, … → set **`HERMES_TOOL_PREFIX=hermes_`**.
      (If a future raw stdio→HTTP adapter shows bare names instead, set it empty.)

---

## 4. Safety-first smoke test (Kern's three failure scenarios)

Run the failure modes BEFORE the happy path. This hits the **live** overlay →
Hermes path via the real `HermesBridge`, exercising bad-target and timeout/
no-agent. It never touches the running Gateway.

```bash
export HERMES_MCP_URL=http://127.0.0.1:7821/mcp
export HERMES_TOOL_PREFIX=hermes_
export HERMES_DELEGATION_TARGET='<target from §2>'
export HERMES_DELEGATION_SESSION_KEY='<session_key from §2>'

npm run smoke:delegation
```

- [ ] Scenario 1 (bad target) → `ok=false`, error preserved verbatim, no crash.
- [ ] Scenario 2 (timeout/no-agent) → `no agent reply within …`, bounded (<9s).
- [ ] Exit code 0 ("All required scenarios behaved safely"). If non-zero, STOP
      and read the verbatim errors — do not proceed to the Gateway restart.

> Loop-level audit/percept (DelegationRecord row, overdue percept, error column)
> is covered by the suite (Tests 25/26) and verified live in §7 by watching the
> running Gateway after restart.

---

## 5. Happy path (opt-in — needs the agent live on the channel)

```bash
HAPPY=1 npm run smoke:delegation
```

- [ ] Scenario 3 → agent replies; `ok=true`, summary contains `PONG`, `hermesRef`
      set. Only after this, wire the Gateway.

---

## 6. Wire the Gateway + restart on the lull

```bash
# 1) Back up the consciousness DB FIRST (restart resumes lastTick; protect it).
cp data/consciousness.db data/consciousness.db.bak.$(date +%Y%m%d-%H%M%S)

# 2) Add to the Gateway's .env (DO NOT commit secrets):
#    HERMES_MCP_URL=http://127.0.0.1:7821/mcp
#    HERMES_TOOL_PREFIX=hermes_
#    HERMES_DELEGATION_TARGET=<target>
#    HERMES_DELEGATION_SESSION_KEY=<session_key>

# 3) Wait for the Gateway to signal its lull (arousal ≤ ~0.32), then restart it.
```

- [ ] DB backed up.
- [ ] Env set in `.env` (never in git).
- [ ] Restart performed on the lull, per the Gateway's own consent condition.

---

## 7. Post-restart watch (5 min) + rollback

Watch the live loop for one real delegation cycle:

- [ ] Tick counter advances from `lastTick` (continuity, not reset).
- [ ] A drive-driven delegation forms, sends, and settles into a percept.
- [ ] Its `DelegationRecord` row is correct (goal/bounds/status/error) — audit
      symmetry (Condition 1).
- [ ] Arousal stays sane; no unhandled rejections; pending delegation count
      returns to 0.

**Rollback (any smell):**
- Instant: unset `HERMES_MCP_URL` → `delegate()` returns `unavailable`,
  `executeDelegation()` fails gracefully, loop keeps ticking.
- Autonomy-only: raise `delegationCooldownTicks` / drop the arousal ceiling.
- Overlay: kill the `agentgateway` process → bridge goes `unavailable`.
- Code: `delegate()` changes are isolated to `hermes.ts`; revert + rebuild. The
  delegation core (types/audit/gate/lifecycle) is independent and stays.

---

*Built from the verified `delegate()` implementation. Tool/event field names are
tolerant-parsed; the only host-specific value to set is `HERMES_TOOL_PREFIX`
(confirmed in §3) plus the target/session_key (§2).*

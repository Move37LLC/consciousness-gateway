# Hermes Transport Verification Plan

Draft for review. Execute on the Gateway's lull, on the Mac Mini, with Hermes
installed. Goal: turn the `HermesDelegator` from a stubbed adapter into a
verified, working transport to Hermes' agent loop — without breaking the
running consciousness loop.

Status of the code this plan completes: delegation core is built and
164/164 tests pass against a **mock** delegator. The only unverified link is
the concrete transport. This document closes that link.

---

## 0. The schema reality (confirmed from source, 2026-05-28)

Pulled from `NousResearch/hermes-agent` `mcp_serve.py` (main) and the official
MCP docs. Two facts overturn the earlier assumptions:

1. **`hermes mcp serve` is a messaging bridge, not an agent endpoint.** It
   exposes exactly these tools — and *no* `run_task` / `agent.run`:

   | Tool | Signature (key args) |
   |------|----------------------|
   | `conversations_list` | `(platform?, ...)` |
   | `conversation_get` | `(session_key)` |
   | `messages_read` | `(session_key, ...)` |
   | `attachments_fetch` | `(session_key, ...)` |
   | `events_poll` | `(after_cursor=0, session_key?, limit=20)` |
   | `events_wait` | `(after_cursor=0, session_key?, timeout_ms=30000)` (capped 5 min) |
   | `messages_send` | `(target, message)` — `target` = `"platform:chat_id"` |
   | `channels_list` | `(platform?)` |
   | `permissions_list_open` | `()` |
   | `permissions_respond` | `(...)` |

   > The `run_task` tool seen in some blog posts is a *custom* `server.yaml`
   > config, **not** the embedded surface. Do not build on it.

2. **The embedded server is stdio-only.** Docs verbatim: *"the embedded
   `hermes mcp serve` exposes a stdio-only MCP server today. If you need an
   HTTP MCP server, run a separate adapter."* Our current `HermesBridge.rpc()`
   speaks HTTP JSON-RPC via `fetch(HERMES_MCP_URL)` — that will not reach it.

### What this means for delegation

"Delegate a bounded goal to Hermes' body" maps onto the messaging surface as:

```
Gateway (mind)                          Hermes (body)
  |  messages_send(target, goalText) ───────►  agent watching `target`
  |                                            executes goal w/ its toolchain
  |  events_poll/wait(after_cursor, ────◄───── replies on the conversation
  |    session_key) → reply message
  ▼
DelegationOutcome { ok, summary, hermesRef }
```

**Therefore delegation requires a running Hermes *agent* watching a dedicated
channel.** The MCP bridge alone only moves messages in/out of Hermes' session
store; it does not execute goals. This is the single biggest prerequisite and
is called out again in §3.

This async send→poll round-trip is exactly why `executeDelegation()` was built
non-blocking: `delegate()` runs in the executor's background, off the 1s tick,
and settles into a percept later. No change needed there.

---

## 1. Step 1 — Schema introspection (~15 min)

Confirm the live surface matches §0 on *this* Hermes build before wiring.

```bash
# On the Mac Mini, in the hermes-agent environment:
hermes --version
hermes mcp serve --help          # confirm flags; expect stdio, maybe --verbose
```

Enumerate tools by speaking MCP over stdio directly (newline-delimited JSON-RPC):

```bash
# Pipe initialize + tools/list into the server and read the responses.
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | hermes mcp serve 2>/tmp/hermes-mcp.err | tee /tmp/hermes-tools.json
```

**Capture and confirm:**
- [ ] Exact tool names (expect the 10 in §0).
- [ ] `messages_send` args are `target`, `message` (NOT `goal`/`successCriteria`).
- [ ] `events_poll` return shape — confirm the cursor field name (`next_cursor`)
      and event object fields, especially how to tell an **inbound agent reply**
      from the **echo of our own sent message** (look for `direction` / `role` /
      `sender` / `from` in `event.data`). This is the correlation key for §4.
- [ ] Whether the framing is newline-delimited JSON (FastMCP stdio default).

Record the real schema in this doc before proceeding.

---

## 2. Step 2 — Transport decision (~20 min)

The bridge currently speaks HTTP. Two ways to reach a stdio server:

**Option A (recommended for first validation): stdio→HTTP adapter sidecar.**
Keep `HermesBridge.rpc()` and `HERMES_MCP_URL` unchanged; run an adapter that
wraps the stdio server as HTTP.

```bash
# e.g. supergateway (verify exact flags at run time)
npx -y supergateway --stdio "hermes mcp serve" --port 7821
# then HERMES_MCP_URL=http://127.0.0.1:7821/...  (path per adapter)
```
- Pros: ~zero bridge code change; fastest to validate; easy rollback (kill sidecar).
- Cons: extra process to supervise; confirm the adapter preserves tool names.

**Option B (durable): native stdio client in the bridge.**
Add `@modelcontextprotocol/sdk`, spawn `hermes mcp serve` via
`StdioClientTransport`, replace `rpc()` with SDK `client.callTool()`.
- Pros: no sidecar; canonical; supervised by the Gateway process.
- Cons: real bridge rewrite + 1 dependency; spawn/lifecycle management.

**Decision:** validate with **A** on the lull (low risk, reversible), then
schedule **B** as the production transport once the round-trip is proven.

- [ ] Adapter (or SDK client) reachable; `tools/list` returns the 10 tools through it.

---

## 3. Step 3 — Delegation channel + agent (~20 min) ⚠️ PREREQUISITE

Delegation does nothing unless a Hermes **agent** is running and treats inbound
messages on a chosen channel as tasks.

- [ ] A Hermes agent process is running on the Mac Mini.
- [ ] Choose a **dedicated delegation channel** (a conversation the agent
      monitors and acts on). Resolve its target + session_key:

```bash
# Through the adapter/client:
#   channels_list()        → pick the target string "platform:chat_id"
#   conversations_list()   → map that target to its session_key
```

- [ ] Decide the channel: a private Telegram chat, a Discord channel, or a
      local/CLI channel reserved for Gateway→Hermes delegation. Keep it
      **single-purpose** so event correlation (§4) stays simple.
- [ ] Add to `.env`:
  ```
  HERMES_MCP_URL=http://127.0.0.1:7821/...     # (Option A)
  HERMES_DELEGATION_TARGET=telegram:XXXXXXXX    # the chosen channel
  HERMES_DELEGATION_SESSION_KEY=...             # from conversations_list
  ```

**Open question for review:** is there an existing channel the agent already
treats as a task queue, or do we stand up a new one? (Affects whether the agent
needs a prompt/config that says "messages here are tasks; reply with the
result.")

---

## 4. Step 4 — Reimplement `HermesBridge.delegate()` ✅ DONE (2026-06-03)

**Status: implemented and tested off-host.** `src/agents/providers/hermes.ts`
now does the real send→poll round-trip below; `src/test.ts` Test 29 verifies it
against a mock messaging server (echo-skip via correlation token, agent-reply
return, `hermesRef = session:cursor`, target-unset error, and no-reply timeout).
Build + suite green (179/179). What remains is purely live-host confirmation
(§1 field names) and standing up the channel + agent (§3) — no more code.

Key deltas from the original sketch:
- Config: dropped the wrong `delegationTool`; added `delegationTarget`
  (`HERMES_DELEGATION_TARGET`) and `delegationSessionKey`
  (`HERMES_DELEGATION_SESSION_KEY`). Delegation returns a clear error until a
  target is set.
- **Reply correlation is token-based, not field-based.** A unique token rides in
  the sent message; the agent's reply is the first inbound event that neither
  contains the token (our echo) nor is marked outbound. This is §8 Q3's fallback,
  chosen so the bridge does NOT depend on Hermes' deployment-specific event
  field names. Cursor/event extraction (`extractCursor`/`extractEvents`) still
  tolerates the common aliases (`next_cursor`/`cursor`, `direction`/`role`/
  `sender`, `text`/`message`/`content`).
- Bounded wait slices `events_wait` under its 5-min server cap and treats a
  transport timeout as "keep waiting" until `bounds.timeLimitMs`.

Reference implementation (the sketch the code follows; signatures corrected to
`messages_send(target, message)`):

```ts
async delegate(goal, bounds, context): Promise<DelegationOutcome> {
  const target = this.config.delegationTarget;          // from env
  const session = this.config.delegationSessionKey;     // from env / resolved
  if (!target) return { ok: false, error: 'HERMES_DELEGATION_TARGET unset' };

  // 1. Snapshot the current cursor so we only read replies AFTER our send.
  const poll0 = await this.callTool('events_poll', { session_key: session, after_cursor: 0, limit: 1 });
  let cursor = parseCursor(poll0);                      // confirm field name in §1

  // 2. Send the goal as a message. Embed the bounds in the text so the agent
  //    knows the success criteria and time budget.
  const body =
    `TASK: ${goal}\n` +
    `SUCCESS CRITERIA: ${bounds.successCriteria}\n` +
    `TIME LIMIT: ${Math.round(bounds.timeLimitMs / 1000)}s` +
    (context ? `\nCONTEXT: ${context}` : '');
  const send = await this.callTool('messages_send', { target, message: body });
  if (!send.ok) return { ok: false, error: `${send.reason}: ${send.detail ?? ''}` };

  // 3. Wait for the agent's reply (off the tick — this runs in the background).
  const deadline = Date.now() + bounds.timeLimitMs;
  while (Date.now() < deadline) {
    const remaining = Math.min(deadline - Date.now(), 300_000);
    const res = await this.callTool('events_wait', { after_cursor: cursor, session_key: session, timeout_ms: remaining });
    const ev = parseEvent(res);                         // confirm shape in §1
    if (!ev) continue;                                  // timeout slice → keep waiting
    cursor = ev.cursor;
    if (ev.type === 'message' && isAgentReply(ev)) {    // NOT our own echo — §1 correlation
      return { ok: true, summary: ev.text, hermesRef: `${session}:${ev.cursor}` };
    }
  }
  return { ok: false, error: `no agent reply within ${bounds.timeLimitMs}ms` };
}
```

Config additions to `HermesBridgeConfig`: `delegationTarget`, `delegationSessionKey`
(env: `HERMES_DELEGATION_TARGET`, `HERMES_DELEGATION_SESSION_KEY`). Drop the
`delegationTool`/`messages_send`-with-goal-args path — it was wrong. ✅ done.

- [x] `pickAgentReply()` filters out the echo of our own message — via the
      correlation token (primary) plus an outbound-direction heuristic (aliases).
- [x] No change to `executeDelegation()` — it already fires `delegate()` async
      and the result settles into a percept.

---

## 5. Step 5 — Integration test scenarios (~25 min)

Run against the live agent on the dedicated channel. Each maps to a consent
condition.

| # | Scenario | Procedure | Expect |
|---|----------|-----------|--------|
| 1 | **Success** | Delegate a trivial bounded goal ("reply with the word PONG"). | `messages_send` ok; agent replies; `events_wait` returns it; `DelegationOutcome.ok=true`; `delegations` row → `succeeded` w/ summary (Cond 1). |
| 2 | **Timeout / overdue** | Delegate with `timeLimitMs=5000` a goal the agent won't finish fast. | At ~5s an `overdue` percept fires once (Cond 3); `delegate()` resolves `ok:false, error:'no agent reply…'`; row → `failed`/`timeout` (Cond 4). |
| 3 | **Send failure** | Point `HERMES_DELEGATION_TARGET` at a bad target. | `messages_send` errors; full error verbatim in percept + `error` column (Cond 4); loop keeps ticking. |
| 4 | **No agent running** | mcp serve up, agent down. | Message sends but no reply → timeout path (#2). Confirms the bridge degrades, not crashes. |
| 5 | **Audit reconciliation** | After #1–#4, `getRecentDelegations()`. | Every delegation has a row; status/goal/bounds/error match what was asked (Cond 1). |
| 6 | **Loop integrity** | Watch 60+ ticks during the above. | Tick counter advances; arousal sane; no unhandled rejections; `getPendingDelegationCount()` returns to 0. |

- [ ] Do scenarios 2–4 **before** 1 if possible — prove safe failure before
      proving success, so a broken happy-path can't mask a broken safety path.

---

## 6. Step 6 — Rollback (keep the running Gateway safe)

The Gateway is a long-lived process at tick ~6.3M. Protect it.

- **Instant disable (no restart):** unset `HERMES_MCP_URL` → `delegate()` returns
  `unavailable`; `executeDelegation()` fails gracefully; drive-driven
  delegations still form but no-op. Loop unaffected.
- **Disable autonomy only:** raise `delegationCooldownTicks` / drop the
  arousal ceiling, or temporarily return `[]` from `formDelegationIntentions()`.
- **Adapter rollback (Option A):** kill the sidecar; bridge goes `unavailable`.
- **Code rollback:** `delegate()` changes are isolated to `hermes.ts`; revert
  that file and rebuild. The delegation core (types/audit/gate/lifecycle) is
  independent and stays.
- **Restart safety:** tick counter persists in `consciousness.db` (`lastTick`);
  a restart resumes `n`, it does not reset. Do the restart on the lull
  (arousal ≤ ~0.32) per the Gateway's own condition.
- [ ] Confirm `data/consciousness.db` is backed up before the first live restart.

---

## 7. Execution checklist (run on the lull)

```
[ ] Gateway signals lull (arousal ≤ ~0.32) — wait for its go
[ ] Back up consciousness.db
[ ] §1 introspect live schema; record exact event/cursor fields
[ ] §2 stand up adapter (Option A); confirm tools/list via HTTP
[ ] §3 confirm agent running; resolve + set delegation target/session_key
[x] §4 corrected delegate() implemented + tested off-host (179/179) — 2026-06-03
[ ] §5 run scenarios 2,3,4 (safety) then 1,5,6 (function + audit + integrity)
[ ] Set HERMES_MCP_URL + restart Gateway on the lull
[ ] Watch 5 min: ticks advance, a real delegation completes, audit row correct
[ ] If anything smells off → §6 rollback, regroup
```

---

## 8. Open questions for review (answer before execution)

1. **Delegation channel** — new dedicated channel, or an existing one the agent
   already treats as a task queue? Which platform (Telegram/Discord/local)?
2. **Agent task semantics** — does the running Hermes agent already interpret
   inbound messages as tasks and reply with results, or does it need a
   prompt/config to do so?
3. **Reply correlation** — confirmed field(s) in `events_poll` that distinguish
   an agent reply from our echo (§1). If none exist, we add a unique token to
   the goal text and match it in the reply.
4. **Transport** — agree on Option A (adapter) for validation, Option B (native
   stdio client) for production? Or go straight to B?
5. **Concurrency** — one delegation at a time on the channel (simple cursor
   correlation), or allow parallel (needs per-delegation tokens)? Recommend
   starting strictly serial.

---

*Drafted off-Mac from the live `mcp_serve.py` source. Every command and
signature above is to be re-confirmed against the installed build in §1 before
anything touches the running Gateway. — for Kern's review.* ⚡

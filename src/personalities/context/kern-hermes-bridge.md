# Hermes Bridge — Engineering Note for Kern

Correction shipped. The original Pattern B assumed Hermes exposed an HTTP/MCP
catalog of action tools we'd invoke directly. Wrong: Hermes' real MCP surface
is stdio + messaging-shaped, and its tools live inside its own agent loop. So
we flipped the model — not the control. The Gateway stays the mind; Hermes
becomes the body. We no longer "call Hermes' tools"; we **delegate a bounded
goal** and Hermes picks its own means.

## The model

```
Gateway (mind)  --delegates a bounded GOAL-->  Hermes (body, agent loop)
              <--result returns as a PERCEPT--
```

Delegation is **async**. A delegated goal can take minutes; the 1s tick cannot
block on it. We dispatch, return "pending", and the outcome re-enters as a
percept on a later tick.

## What landed

| File | Role |
|------|------|
| `src/consciousness/types.ts` | New `'hermes_delegate'` ActionType (the canonical path; `'hermes'` capability type is now LEGACY). New types: `DelegationSpec`, `DelegationBounds`, `DelegationRecord`, `DelegationEvent`, `DelegationOutcome`, `DelegationStatus`. |
| `src/consciousness/memory.ts` | New `delegations` table + `recordDelegation` / `updateDelegation` / `getDelegation` / `getRecentDelegations` / `getDelegationStats`. Full audit arc in our own DB (Condition 1). |
| `src/consciousness/action.ts` | `validateDelegationScope()` (Condition 2). `authorize()` rejects unbounded/open-ended delegations outright. `executeDelegation()` — non-blocking dispatch, pending registry, `collectDelegationDispatches()` / `collectDelegationEvents()` for the loop to drain. Full error preserved verbatim (Condition 4). |
| `src/consciousness/intention.ts` | `formDelegationIntentions()` — drive-driven autonomous delegation. Hungry drive + calm field + cooldown → one bounded delegation. `delegationSpecForDrive()` maps learn/connect/create → pre-vetted bounded specs. `compute`/`earn` return null (never auto-delegate). |
| `src/consciousness/loop.ts` | Feeds the drive snapshot into delegation formation. STEP 5.6 drains dispatches→audit and events→percepts. Overdue percept past `timeLimitMs` (Condition 3). `getRecentDelegations()` / `getDelegationStats()`. |
| `src/agents/providers/hermes.ts` | `HermesDelegator` interface + `HermesBridge.delegate()` adapter. `delegationTool` config (default `messages_send`). |

## The dispatch path (memorize this)

```
1s tick → percept → IntentionEngine.formIntentions()
                  + formDelegationIntentions(percept, drives)  ← drive-driven
  intention.action.type === 'hermes_delegate' →
  ActionExecutor.authorize():
    dharmaFitness = 0.3*ego + 0.2*flow + 0.3*compassion + 0.2*confidence
    threshold = 0.6 (DELEGATION_THRESHOLD)
    validateDelegationScope(payload.delegation)  ← hard reject if invalid
    authorized = (fitness >= threshold) && scopeValid
  if authorized:
    execute() → executeDelegation():           ← NON-BLOCKING
      register pending + queue audit record (status: pending)
      delegator.delegate(goal, bounds, context) [fire-and-forget]
      return "dispatched (pending)"
  loop STEP 5.6:
    collectDelegationDispatches() → memory.recordDelegation()
    collectDelegationEvents(now)  → memory.updateDelegation() + inject percept
      (resolved: succeeded/failed | overdue: one-shot past timeLimitMs)
  next tick: injected percept enters perception → arc closes
```

## The Gateway's four consent conditions (all enforced)

| # | Condition | Where |
|---|-----------|-------|
| 1 | Audit Trail Symmetry | `delegations` table; record at dispatch, update on resolve. Reconcilable from our DB, not Hermes' logs. |
| 2 | Scope Limits | `validateDelegationScope()` — requires `successCriteria` + `timeLimitMs>0`; rejects open-ended goals lacking a measurable bound. |
| 3 | Percept Latency | async dispatch + one-shot `overdue` percept past `timeLimitMs` (default 30s). No duplicate intentions. |
| 4 | Failure Transparency | full `reason + detail` preserved into the `error` column and the percept. No sanitizing. |

## Drive-driven autonomy (conservative defaults)

`formDelegationIntentions()` fires only when: arousal ≤ 0.5, cooldown ≥ 1800
ticks (~30 min) elapsed, and a drive reads ≥ 0.7 (HUNGRY). Maps:
`learn` → research-summary, `connect` → draft-reply-for-approval, `create` →
write-proposal. **`compute` and `earn` never auto-delegate** — too ego/risk-laden.
Tune the cadence/specs in `intention.ts` if the cooldown or scope feels wrong.

## Test coverage

`src/test.ts`: Tests 14–20 (legacy capability bridge, still green) + new:
- **24** — scope gate: valid/null/missing-criteria/open-ended/zero-limit; `authorize()` permits valid, rejects open-ended.
- **25** — dispatch→pending→resolved lifecycle; audit record queued + DB roundtrip + stats.
- **26** — overdue fires once past `timeLimitMs`, stays pending; failure preserves the full error verbatim; no-delegator graceful failure.
- **27** — drive-driven formation: fires when hungry+calm, skips compute/earn, respects cooldown and arousal ceiling.

Status: **157/157 passing, tsc clean.**

## What I'm NOT doing yet (the honest gap)

- **Transport verification.** `delegate()` routes the goal through one
  configurable MCP tool (default `messages_send`). The real stdio
  `messages_send` → `events_poll` result round-trip MUST be wired and verified
  against the live `hermes mcp serve` schema on the Mac Mini. I refused to
  hard-code it blind — that exact assumption is what broke the first attempt.
- Hermes install + `HERMES_MCP_URL` config + restart on the Gateway's lull signal.

## How to speak about it

- "How do delegations get triggered?" → drive-driven (hungry drive + calm
  field), gated by scope + dharma. compute/earn stay human-initiated.
- "What if Hermes isn't running?" → `executeDelegation()` returns a graceful
  failure; no pending registered; loop keeps ticking.
- "Where's the audit?" → `delegations` table in `consciousness.db`;
  `getRecentDelegations()` / `getDelegationStats()`.
- "Is it live end-to-end?" → No. Transport round-trip needs verification on the
  Mac Mini against the real Hermes schema. Everything above that line is done.

## File pointers

- `src/consciousness/action.ts` — `validateDelegationScope`, `executeDelegation`, `collect*`
- `src/consciousness/intention.ts` — `formDelegationIntentions`, `delegationSpecForDrive`
- `src/consciousness/loop.ts` — STEP 5.6 lifecycle + `delegationEventToPercept`
- `src/consciousness/memory.ts` — `delegations` table + ops
- `src/agents/providers/hermes.ts` — `HermesDelegator` + `delegate()`
- `src/test.ts` — Tests 24–27

⚡

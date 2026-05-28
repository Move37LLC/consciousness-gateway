# Hermes Bridge — Engineering Note for Kern

Pattern B of the Hermes integration roadmap. Shipped. Here's the scoreboard
and what I want you to know cold so you can answer questions accurately.

## Scoreboard

```
Tests:        108 passed, 0 failed     (was 76 — added 32 new)
Build:        tsc strict mode clean
New deps:     0  (Node 18+ global fetch)
Files added:  3   (hermes.ts, ROADMAP.md, briefings)
Files modified: 6 (types, action, loop, no-self, index, README, .env.example)
LOC delta:    ~700 added, ~30 modified
```

## What landed

| File | Role |
|------|------|
| `src/agents/providers/hermes.ts` | New `HermesBridge` class. MCP-over-HTTP via JSON-RPC 2.0. Transport-agnostic. Configurable `toolMap` per deployment. 30s default timeout via `AbortController`. Structured error reasons: `unavailable` / `timeout` / `error`. Lazy `initialize()`, cached `listTools()`. |
| `src/consciousness/types.ts` | Added `'hermes'` to `ActionType` union. New `HermesCapability` union with 8 capabilities. |
| `src/consciousness/action.ts` | `ActionExecutor` constructor takes optional `HermesBridge`. New `executeHermes()` dispatcher. Per-capability dharma thresholds table: `HERMES_THRESHOLDS`. `intentionToVector()` extended with `'hermes': 0.8` encoding. New `setHermesBridge()` + `getHermesBridge()` accessors. |
| `src/consciousness/loop.ts` | Loop instantiates `new HermesBridge()` automatically from env. New `getHermesStatus()` and `getHermesBridge()` on the loop. |
| `src/dharma/no-self.ts` | New `reviewSkill()` method + `SkillReview` interface. Scores self-pronoun density, possessive identity, self-preservation, ontological claims. Acceptance threshold: `score < 0.3`. |
| `src/index.ts` | New routes: `GET /v1/hermes` (status + lazy tool discovery), `POST /v1/hermes/refresh` (force re-discovery). `/v1/health` now embeds `hermes` block. Startup logs show bridge state. |
| `.env.example` | `HERMES_MCP_URL`, `HERMES_AUTH_TOKEN` documented. |
| `README.md` | New "Hermes Bridge (Pattern B)" section with threshold table + setup. |
| `ROADMAP.md` | Pattern A (4 milestones, ~4 weeks) + Pattern C (6 milestones, ~6 weeks) with done criteria and risks. |

## The dispatch path (memorize this)

```
1s tick → percept → IntentionEngine.formIntentions() →
  rawIntentions[*].action.type === 'hermes' →
  ActionExecutor.authorize():
    intentionToVector() → noSelf.observe()
    entropy.computeEntropy() → flow state
    compassion.evaluate() → score
    dharmaFitness = 0.3*ego + 0.2*flow + 0.3*compassion + 0.2*confidence
    threshold = HERMES_THRESHOLDS[payload.hermesCapability]  ← key step
    authorized = (dharmaFitness >= threshold)
  if authorized:
    ActionExecutor.execute() → executeHermes() →
    dispatchHermesCapability() → bridge.{spawnSubagent|runSkill|...}() →
    bridge.callTool() → bridge.rpc('tools/call', ...) → fetch(HERMES_MCP_URL)
```

## Per-capability dharma thresholds

| Capability | Threshold | Why |
|------------|-----------|-----|
| `memory_search` | 0.20 | Read-only, no world contact |
| `list_skills` / `list_tools` | 0.20 | Read-only |
| `schedule_cron` | 0.50 | Deferred but real future action |
| `run_skill` | 0.55 | Dharma-vetted procedural memory |
| `spawn_subagent` | 0.60 | Long-horizon work in a sandbox |
| `send_channel` | 0.70 | Outbound speech — ethos-critical |
| `run_tool` | 0.75 | Direct world contact (shell, files) |

**These numbers are educated guesses, not calibrated.** Top of my TODO
for v0.4: log a week of `dharmaFitness` distributions per capability
against real Hermes traffic and reset thresholds to empirical percentiles.

## Test coverage

Tests 14–20 in `src/test.ts`:

- **14** — disabled-mode (no `HERMES_MCP_URL`): all calls return structured `unavailable`, no exceptions.
- **15** — authorization gating: `memory_search` clears low bar, `run_tool` requires high bar.
- **16** — graceful execute fallback when bridge absent + missing-capability error path.
- **17** — full MCP round-trip against an in-process mock HTTP server (initialize → tools/list → tools/call).
- **18** — `ActionExecutor.execute()` end-to-end through the live mock bridge.
- **19** — `reviewSkill()` accepts clean functional skills, rejects ego-laden skills, handles empty input.
- **20** — `ConsciousnessLoop.getHermesStatus()` integration.

## What I'm NOT doing yet

- Pattern A.1 (OpenAI-compatible endpoint on the Gateway) — gated on
  whether we want Hermes' inference to also pass through GATO. Not yet.
- Bidirectional event subscription (Pattern A.4) — needs a `HermesMonitor`
  implementing `MonitorPlugin`. Roadmapped, not built.
- Threshold calibration against real traffic — needs a running Hermes to
  call the bridge against. Currently calling against a mock in tests.
- Toolmap calibration — `DEFAULT_TOOL_MAP` assumes Hermes' MCP tool
  names. If they differ in practice, override per-deployment via
  `HermesBridgeConfig.toolMap`.

## How to speak about it

When Javier asks:

- "How do I configure it?" → `HERMES_MCP_URL` in `.env`. Restart. Hit
  `GET /v1/hermes` to verify.
- "What if Hermes isn't running?" → Bridge returns `unavailable`, loop
  keeps ticking, hermes-typed intentions fail authorization gracefully.
  No regression.
- "Did you add dependencies?" → No. Used Node 18+ global `fetch`. Tests
  use the built-in `http` module to spin up a mock MCP server in-process.
- "What's next?" → Pattern A.1 if we want Hermes' inference
  GATO-mediated. Threshold calibration regardless.

## File pointers for spot-checking

- `src/agents/providers/hermes.ts` — bridge implementation
- `src/consciousness/action.ts:24-50` — threshold table
- `src/consciousness/action.ts:executeHermes` — execution path
- `src/dharma/no-self.ts:reviewSkill` — skill commit gate
- `src/test.ts` Tests 14-20 — coverage
- `ROADMAP.md` — Pattern A + C sequence

⚡

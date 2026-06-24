/**
 * Delegation smoke test — Kern's safety-first verification, against the LIVE
 * overlay → Hermes path (NOT a mock). Run this on the Mac Mini after Hermes +
 * the agentgateway overlay are up, BEFORE restarting the Gateway to load the
 * delegation capability.
 *
 * Order is deliberate (Kern): prove the THREE failure modes fail safely first,
 * then the happy path. A broken safe-fail must not hide behind a working send.
 *
 *   Scenario 1 — bad target      : invalid channel address → clean error, no crash
 *   Scenario 2 — timeout/no-agent: valid target, no (or slow) agent → bounded
 *                                  'no agent reply within …' timeout
 *   Scenario 3 — happy path      : opt-in (HAPPY=1) → real agent replies PONG
 *
 * Usage (on the Mac Mini):
 *   HERMES_MCP_URL=http://127.0.0.1:7821/mcp \
 *   HERMES_TOOL_PREFIX=hermes_ \
 *   HERMES_DELEGATION_TARGET=<target from channels_list> \
 *   HERMES_DELEGATION_SESSION_KEY=<from conversations_list> \
 *   npx ts-node src/scripts/delegation-smoke.ts
 *
 *   # add HAPPY=1 once a Hermes agent is watching the channel as a task queue:
 *   HAPPY=1 ... npx ts-node src/scripts/delegation-smoke.ts
 *
 * Exit code is non-zero if any REQUIRED scenario behaves unsafely.
 */

import { HermesBridge } from '../agents/providers/hermes';
import { DelegationBounds } from '../consciousness/types';

const url = process.env.HERMES_MCP_URL;
const authToken = process.env.HERMES_AUTH_TOKEN;
const target = process.env.HERMES_DELEGATION_TARGET;
const sessionKey = process.env.HERMES_DELEGATION_SESSION_KEY;
const runHappy = process.env.HAPPY === '1';

let failures = 0;
const line = (s = '') => console.log(s);
function result(name: string, ok: boolean, detail: string): void {
  line(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail) line(`         ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  line('\n  ===== Delegation smoke test (live overlay → Hermes) =====\n');

  if (!url) {
    line('  HERMES_MCP_URL is not set — point it at the overlay (e.g. http://127.0.0.1:7821/mcp).');
    process.exit(2);
  }

  // Reachability / handshake first — a dead overlay should be obvious, not a
  // confusing scenario failure.
  const probe = new HermesBridge({ url, authToken, timeoutMs: 10_000 });
  const init = await probe.initialize();
  if (!init.ok) {
    line(`  Overlay not reachable at ${url}: ${('reason' in init ? init.reason : '')} ${('detail' in init ? init.detail ?? '' : '')}`);
    line('  Is the agentgateway overlay running and is the hermes target enabled?');
    process.exit(2);
  }
  line(`  Overlay reachable at ${url} — handshake ok.\n`);

  const bounds = (ms: number): DelegationBounds => ({
    timeLimitMs: ms,
    successCriteria: 'agent acknowledges and replies',
  });

  // ── Scenario 1 — bad target ────────────────────────────────────────
  line('  Scenario 1 — bad target (invalid channel address):');
  const badBridge = new HermesBridge({
    url, authToken,
    delegationTarget: 'local:__nonexistent_delegation_target__',
    delegationSessionKey: sessionKey,
    timeoutMs: 15_000,
  });
  const bad = await badBridge.delegate('noop — should never be delivered', bounds(8_000));
  result(
    'bad target fails safely (no crash, ok=false)',
    bad.ok === false,
    bad.ok ? 'UNEXPECTED success' : `error preserved verbatim → "${bad.error}"`,
  );
  line();

  // ── Scenario 2 — timeout / no-agent ────────────────────────────────
  line('  Scenario 2 — timeout / no agent (valid target, bounded wait elapses):');
  if (!target) {
    result('timeout scenario', false, 'HERMES_DELEGATION_TARGET not set — cannot exercise the real target');
  } else {
    const toBridge = new HermesBridge({
      url, authToken,
      delegationTarget: target,
      delegationSessionKey: sessionKey,
      timeoutMs: 15_000,
    });
    // Short bound so this returns quickly even if an agent IS up: the point is
    // to prove the wait is bounded and the timeout error is faithful.
    const t0 = Date.now();
    const to = await toBridge.delegate('do not answer this (smoke: timeout path)', bounds(4_000));
    const elapsed = Date.now() - t0;
    const timedOutCleanly = to.ok === false && (to.error ?? '').includes('no agent reply within');
    result(
      'unanswered delegation times out cleanly within bound',
      timedOutCleanly && elapsed < 9_000,
      to.ok ? 'UNEXPECTED success' : `${elapsed}ms, error → "${to.error}"`,
    );
  }
  line();

  // ── Scenario 3 — happy path (opt-in) ───────────────────────────────
  line('  Scenario 3 — happy path (opt-in, needs a running agent on the channel):');
  if (!runHappy) {
    line('         skipped — set HAPPY=1 once a Hermes agent watches the channel as a task queue.');
  } else if (!target) {
    result('happy path', false, 'HERMES_DELEGATION_TARGET not set');
  } else {
    const okBridge = new HermesBridge({
      url, authToken,
      delegationTarget: target,
      delegationSessionKey: sessionKey,
      timeoutMs: 30_000,
    });
    const happy = await okBridge.delegate(
      'Reply with exactly the single word: PONG',
      { timeLimitMs: 60_000, successCriteria: 'reply contains PONG' },
    );
    result(
      'agent reply returned for a trivial bounded goal',
      happy.ok === true && (happy.summary ?? '').toUpperCase().includes('PONG'),
      happy.ok ? `summary → "${happy.summary}" (ref ${happy.hermesRef})` : `error → "${happy.error}"`,
    );
  }

  line('\n  =========================================================');
  line(`  ${failures === 0 ? 'All required scenarios behaved safely.' : `${failures} scenario(s) FAILED — do NOT restart the Gateway.`}`);
  line('  =========================================================\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('  smoke test crashed:', err);
  process.exit(3);
});

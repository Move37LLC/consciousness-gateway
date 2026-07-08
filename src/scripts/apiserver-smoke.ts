/**
 * api_server delegation smoke — Kern's R6' failure-first sequence against the
 * LIVE Hermes api_server (`hermes gateway api_server`, loopback :8642). Run this
 * on the Mac Mini AFTER the api_server is up and its toolset is locked to
 * memory + session_search, and BEFORE wiring the Gateway (R6'.4).
 *
 * Order is mandatory (Kern): prove it FAILS correctly twice, then one happy PONG.
 * We do not wire until 1-2-3 pass clean.
 *
 *   1 — bad-input bounded fail : malformed POST /v1/runs → 4xx, no run, no tools
 *   2 — deadline/stop fail     : valid task, aggressive bound → clean /stop, bounded
 *   3 — PONG happy path (HAPPY=1): memory+session_search only → result in-band,
 *                                  Telegram audit mirror fires
 *
 * Usage (Mac Mini):
 *   HERMES_API_URL=http://127.0.0.1:8642 \
 *   HERMES_API_KEY=<the api_server key> \
 *   npx ts-node src/scripts/apiserver-smoke.ts
 *
 *   # add HAPPY=1 to run scenario 3; add the mirror to see it land in Telegram:
 *   HAPPY=1 TELEGRAM_BOT_TOKEN=<gateway bot> TELEGRAM_CHAT_ID=8217238229 \
 *   HERMES_API_URL=... HERMES_API_KEY=... npx ts-node src/scripts/apiserver-smoke.ts
 *
 * Exit code is non-zero if any REQUIRED scenario behaves unsafely.
 */

import TelegramBot from 'node-telegram-bot-api';
import { ApiServerBridge, MirrorEvent } from '../agents/providers/hermes-apiserver';

const apiUrl = process.env.HERMES_API_URL ?? 'http://127.0.0.1:8642';
const apiKey = process.env.HERMES_API_KEY;
const runHappy = process.env.HAPPY === '1';
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const tgChat = process.env.TELEGRAM_CHAT_ID;

let failures = 0;
const line = (s = '') => console.log(s);
function result(name: string, ok: boolean, detail: string): void {
  line(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail) line(`         ${detail}`);
  if (!ok) failures++;
}

/** Non-polling Telegram sender so we don't collide with the live Gateway poller. */
function buildMirror(): { fn: (ev: MirrorEvent) => Promise<void>; fired: () => number } {
  let count = 0;
  const bot = tgToken ? new TelegramBot(tgToken, { polling: false }) : null;
  const fn = async (ev: MirrorEvent): Promise<void> => {
    count++;
    const text = renderMirror(ev);
    if (bot && tgChat) {
      await bot.sendMessage(tgChat, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } else {
      line(`    · mirror(${ev.phase}) → ${text.replace(/\n/g, ' ')}`);
    }
  };
  return { fn, fired: () => count };
}

function renderMirror(ev: MirrorEvent): string {
  if (ev.phase === 'task') {
    return `📋 *TASK* \`${ev.runId}\`\n🔧 Tools: ${ev.tools.join(', ')}\n${ev.goal ?? ''}`;
  }
  if (ev.phase === 'approval_denied') {
    return `⚠️ *APPROVAL DENIED* \`${ev.runId}\`\nTool: ${ev.tool}\nInput: ${ev.input ?? ''}\nAction: DENIED (default policy)`;
  }
  return `${ev.ok ? '✅' : '❌'} *RESULT* \`${ev.runId}\`\n${ev.ok ? (ev.summary ?? '') : (ev.error ?? '')}\n⏱ ${ev.elapsedMs ?? 0}ms`;
}

async function main(): Promise<void> {
  line('\n  ===== api_server delegation smoke (R6\' failure-first) =====\n');

  if (!apiKey) {
    line('  HERMES_API_KEY is not set — this is the api_server bearer key (the API_SERVER_KEY');
    line('  you configured with `hermes gateway setup` for the api_server platform, NOT an Anthropic key).');
    process.exit(2);
  }

  const mirror = buildMirror();
  const bridge = new ApiServerBridge({
    apiUrl, apiKey,
    allowlist: ['memory', 'session_search'],
    onMirror: mirror.fn,
  });

  // Reachability first.
  const health = await bridge.health();
  if (!health.ok) {
    line(`  api_server not reachable at ${apiUrl}: ${health.detail}`);
    line('  Is `hermes gateway api_server` running and bound to loopback :8642?');
    process.exit(2);
  }
  line(`  api_server reachable at ${apiUrl} — /health ok.\n`);

  // ── Scenario 1 — bad-input bounded fail (raw malformed POST) ───────
  line('  Scenario 1 — bad-input bounded fail (malformed POST /v1/runs → 4xx):');
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/v1/runs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      // Deliberately malformed: no `input`, wrong shape.
      body: JSON.stringify({ not_a_valid_field: 12345 }),
    });
    const is4xx = res.status >= 400 && res.status < 500;
    result(
      'malformed run rejected with 4xx (no run created)',
      is4xx,
      `HTTP ${res.status} ${res.statusText}`,
    );
  } catch (err) {
    result('malformed run rejected with 4xx', false, `unexpected transport error: ${err instanceof Error ? err.message : String(err)}`);
  }
  line();

  // ── Scenario 2 — deadline / stop bounded fail ──────────────────────
  line('  Scenario 2 — deadline/stop bounded fail (aggressive bound → clean stop):');
  const t0 = Date.now();
  const stopped = await bridge.delegate(
    'Think carefully and write a long multi-paragraph essay about the history of timekeeping.',
    { timeLimitMs: 800, successCriteria: 'completes within the (intentionally too-short) bound' },
  );
  const elapsed = Date.now() - t0;
  const boundedFail = stopped.ok === false && /within \d+ms|stopped/i.test(stopped.error ?? '');
  result(
    'run exceeding bound is stopped cleanly and returns bounded error',
    boundedFail && elapsed < 6_000,
    stopped.ok ? 'UNEXPECTED success' : `${elapsed}ms, error → "${stopped.error}" (ref ${stopped.hermesRef})`,
  );
  line();

  // ── Scenario 3 — PONG happy path (opt-in) ──────────────────────────
  line('  Scenario 3 — PONG happy path (opt-in HAPPY=1, memory+session_search only):');
  if (!runHappy) {
    line('         skipped — set HAPPY=1 to exercise a real run against the locked toolset.');
  } else {
    const before = mirror.fired();
    const happy = await bridge.delegate(
      'Respond with exactly the single word: PONG',
      { timeLimitMs: 60_000, successCriteria: 'reply contains PONG' },
    );
    const mirrored = mirror.fired() - before;
    const okPong = happy.ok === true && (happy.summary ?? '').toUpperCase().includes('PONG');
    result(
      'result returns in-band and contains PONG',
      okPong,
      happy.ok ? `summary → "${happy.summary}" (ref ${happy.hermesRef})` : `error → "${happy.error}"`,
    );
    result(
      'audit mirror fired (TASK + RESULT)',
      mirrored >= 2,
      `${mirrored} mirror event(s)${tgToken && tgChat ? ' → Telegram' : ' → console (no TELEGRAM_BOT_TOKEN/CHAT_ID)'}`,
    );
  }

  line('\n  =============================================================');
  line(`  ${failures === 0 ? 'All required scenarios behaved safely — clear to wire (R6\'.4).' : `${failures} scenario(s) FAILED — do NOT wire the Gateway.`}`);
  line('  =============================================================\n');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('  smoke test crashed:', err);
  process.exit(3);
});

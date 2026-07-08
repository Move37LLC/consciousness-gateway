/**
 * Hermes API-Server Bridge — the delegation transport Kern ruled in on
 * 2026-07-07 (R1' = api_server, ACP vacated; see HERMES_TRANSPORT_VERIFICATION).
 *
 * WHY THIS EXISTS (and why the messaging `HermesBridge` is now dormant):
 *   `hermes mcp serve` (the messaging bridge) can only send OUTBOUND as the bot
 *   and cannot hand the agent a prompt (Hermes #27528) — Path A was structurally
 *   impossible. `hermes acp` CAN task the agent but its toolset is not lockable
 *   via `hermes tools` (acp is not a governable platform) and it auto-runs read
 *   tools, so it fails Kern's R4/R5. The OpenAI-compatible **api_server**
 *   (`gateway/platforms/api_server.py`) is the one transport that is BOTH
 *   programmatically taskable AND toolset-lockable — verified live: with
 *   `hermes tools --platform api_server` the agent resolves to `memory` +
 *   `session_search` ONLY (`GET /v1/toolsets`).
 *
 * TWO GATES (Kern R2'):
 *   Gate 1 (structural, PRIMARY): the api_server toolset lock — the agent
 *     physically cannot call terminal/web/file/etc. Can't-call beats won't-approve.
 *   Gate 2 (runtime): this bridge watches `/v1/runs/{id}/events`; ANY approval
 *     request is DEFAULT-DENIED via `/v1/runs/{id}/approval` and escalated to the
 *     Telegram audit channel (deny + escalate). Escalation failure warns, never
 *     blocks.
 *
 * AUDIT MIRROR (Kern R3): every TASK and RESULT is mirrored to Telegram via the
 *   injected `onMirror` hook. Mirror failure warns, never blocks the task.
 *
 * Transport: plain HTTP (OpenAI-compatible) on loopback `:8642`, bearer auth.
 * No new npm dependency — Node 18+ global `fetch`.
 */

import { DelegationBounds, DelegationOutcome } from '../../consciousness/types';
import { HermesDelegator } from './hermes';

/** A single audit-mirror event the Gateway narrates to Telegram (R3). */
export interface MirrorEvent {
  phase: 'task' | 'result' | 'approval_denied';
  runId?: string;
  goal?: string;
  tools: string[];
  ok?: boolean;
  summary?: string;
  error?: string;
  elapsedMs?: number;
  /** approval_denied only */
  tool?: string;
  input?: string;
}

export interface ApiServerBridgeConfig {
  /** OpenAI-compatible base, e.g. `http://127.0.0.1:8642`. Env: HERMES_API_URL. */
  apiUrl?: string;
  /** Bearer token = the Hermes API_SERVER_KEY. Env: HERMES_API_KEY. */
  apiKey?: string;
  /** Per-HTTP-call timeout (ms). Default 20s. Distinct from the delegation bound. */
  timeoutMs?: number;
  /** Run-status poll cadence (ms). Default 1500. */
  pollIntervalMs?: number;
  /** Stable long-term-memory scope (X-Hermes-Session-Key). */
  sessionKey?: string;
  /** The tool allowlist advertised in the audit mirror (documentation only —
   *  enforcement is the api_server toolset lock, not this list). */
  allowlist?: string[];
  /** Audit mirror sink (Telegram). Awaited but never allowed to throw upward. */
  onMirror?: (ev: MirrorEvent) => void | Promise<void>;
  /** Enable the best-effort SSE approval watcher (Gate 2). Default true. */
  approvalWatch?: boolean;
}

interface RunState {
  status: string;
  output?: string;
  error?: string;
}

const TERMINAL_OK = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'error', 'cancelled', 'canceled', 'stopped']);

export class ApiServerBridge implements HermesDelegator {
  readonly name = 'hermes-apiserver';
  private readonly config: Required<Pick<ApiServerBridgeConfig, 'timeoutMs' | 'pollIntervalMs' | 'approvalWatch'>> & ApiServerBridgeConfig;
  private lastReachableAt = 0;
  private lastFailureAt = 0;
  private lastFailureReason: string | null = null;

  constructor(config?: ApiServerBridgeConfig) {
    this.config = {
      apiUrl: process.env.HERMES_API_URL,
      apiKey: process.env.HERMES_API_KEY,
      sessionKey: process.env.HERMES_DELEGATION_SESSION_KEY,
      timeoutMs: 20_000,
      pollIntervalMs: 1_500,
      approvalWatch: true,
      allowlist: ['memory', 'session_search'],
      ...(config ?? {}),
    };
  }

  /** True only when a URL + key are configured. */
  get available(): boolean {
    return !!this.config.apiUrl && !!this.config.apiKey;
  }

  get healthy(): boolean {
    return this.lastReachableAt > 0 && this.lastReachableAt > this.lastFailureAt;
  }

  /** GET /health — cheap reachability probe used by the smoke test + status. */
  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.available) return { ok: false, detail: 'HERMES_API_URL / HERMES_API_KEY not set' };
    const res = await this.http('GET', '/health');
    if (res.ok) { this.lastReachableAt = Date.now(); return { ok: true }; }
    return { ok: false, detail: res.detail };
  }

  // ─── Delegation (HermesDelegator) ──────────────────────────────────

  async delegate(goal: string, bounds: DelegationBounds, context?: string): Promise<DelegationOutcome> {
    if (!this.available) {
      return { ok: false, error: 'api_server transport not configured (HERMES_API_URL / HERMES_API_KEY unset)' };
    }
    const started = Date.now();
    const allow = this.config.allowlist ?? [];

    const input =
      `${goal}\n` +
      `SUCCESS CRITERIA: ${bounds.successCriteria}` +
      (bounds.maxResourceUnits ? `\nRESOURCE LIMIT: ${bounds.maxResourceUnits} tool iterations` : '') +
      (context ? `\nCONTEXT: ${context}` : '');

    // 1. Create the run.
    const create = await this.http('POST', '/v1/runs', { input, session_id: this.config.sessionKey });
    if (!create.ok) {
      return { ok: false, error: `run submission failed: ${create.detail}` };
    }
    const runId = pickString(create.json, ['run_id', 'id']) ?? '';
    if (!runId) {
      return { ok: false, error: `run submission returned no run_id: ${truncate(JSON.stringify(create.json), 200)}` };
    }

    // Mirror TASK (warn-not-block).
    await this.mirror({ phase: 'task', runId, goal, tools: allow });

    // 2. Gate 2 — best-effort approval watcher (default-deny + escalate).
    const deadline = started + bounds.timeLimitMs;
    const watcher = this.config.approvalWatch
      ? this.watchApprovals(runId, deadline)
      : { stop: () => { /* noop */ } };

    try {
      // 3. Poll run status for the in-band result until terminal or deadline.
      for (;;) {
        if (Date.now() >= deadline) {
          await this.stopRun(runId);
          const outcome: DelegationOutcome = {
            ok: false, hermesRef: runId,
            error: `no result within ${bounds.timeLimitMs}ms (run stopped)`,
          };
          await this.mirror({ phase: 'result', runId, tools: allow, ok: false, error: outcome.error, elapsedMs: Date.now() - started });
          return outcome;
        }

        const state = await this.getRun(runId);
        if (state && TERMINAL_OK.has(state.status.toLowerCase())) {
          const summary = (state.output ?? '').trim() || 'delegation completed (no text output)';
          await this.mirror({ phase: 'result', runId, tools: allow, ok: true, summary, elapsedMs: Date.now() - started });
          return { ok: true, hermesRef: runId, summary };
        }
        if (state && TERMINAL_BAD.has(state.status.toLowerCase())) {
          const error = (state.error ?? state.output ?? `run ${state.status}`).trim();
          await this.mirror({ phase: 'result', runId, tools: allow, ok: false, error, elapsedMs: Date.now() - started });
          return { ok: false, hermesRef: runId, error };
        }
        await sleep(Math.min(this.config.pollIntervalMs, Math.max(0, deadline - Date.now())));
      }
    } finally {
      watcher.stop();
    }
  }

  // ─── Run lifecycle helpers ─────────────────────────────────────────

  private async getRun(runId: string): Promise<RunState | null> {
    const res = await this.http('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    const j = res.json as Record<string, unknown> | undefined;
    if (!j || typeof j !== 'object') return null;
    return {
      status: String((j as { status?: unknown }).status ?? 'unknown'),
      output: pickString(j, ['output', 'result', 'text']) ?? undefined,
      error: pickString(j, ['error', 'error_message']) ?? undefined,
    };
  }

  private async stopRun(runId: string): Promise<void> {
    await this.http('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`).catch(() => undefined);
  }

  private async denyApproval(runId: string, approvalId: string | undefined, tool: string, input: string): Promise<void> {
    // Default-deny (Kern R2'). Field names vary across builds, so send the common
    // aliases together; unknown extras are ignored server-side.
    const body: Record<string, unknown> = {
      decision: 'deny', approved: false, allow: false, outcome: 'rejected',
    };
    if (approvalId) body.approval_id = approvalId;
    await this.http('POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, body).catch(() => undefined);
    // Escalate to Telegram (deny + escalate). Warn-not-block.
    await this.mirror({ phase: 'approval_denied', runId, tools: this.config.allowlist ?? [], tool, input: truncate(input, 300) });
  }

  /**
   * Best-effort SSE reader over `/v1/runs/{id}/events`. Its ONLY job is Gate 2:
   * spot an approval request and default-deny + escalate. It is deliberately NOT
   * authoritative for the result (polling getRun is) — if the event schema drifts
   * or the stream drops, Gate 1 (the toolset lock) still holds and the poll loop
   * still resolves the run. Tolerant parsing: classify by event name + probe data.
   */
  private watchApprovals(runId: string, deadline: number): { stop: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()) + 5_000);

    (async () => {
      try {
        const res = await fetch(`${this.base()}/v1/runs/${encodeURIComponent(runId)}/events`, {
          method: 'GET',
          headers: { ...this.authHeaders(), Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          // SSE frames are separated by a blank line.
          while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + (buf[idx] === '\r' ? 4 : 2));
            const { event, data } = parseSseFrame(frame);
            if (!event) continue;
            if (/approval|permission|request_permission/i.test(event)) {
              const d = safeJson(data) as Record<string, unknown> | undefined;
              const tool = pickString(d, ['tool', 'tool_name', 'name', 'toolCall', 'action']) ?? 'unknown';
              const inp = pickString(d, ['input', 'arguments', 'args', 'command', 'params']) ?? data ?? '';
              const approvalId = pickString(d, ['approval_id', 'id', 'request_id', 'call_id']);
              await this.denyApproval(runId, approvalId, tool, inp);
            }
          }
        }
      } catch {
        /* stream aborted / closed — Gate 1 + poll loop remain authoritative */
      }
    })();

    return { stop: () => { clearTimeout(timer); controller.abort(); } };
  }

  // ─── Mirror (R3) ───────────────────────────────────────────────────

  private async mirror(ev: MirrorEvent): Promise<void> {
    if (!this.config.onMirror) return;
    try {
      await this.config.onMirror(ev);
    } catch (err) {
      // Warn, never block (Kern R3). The task outcome is independent of the mirror.
      console.warn(`[hermes-apiserver] audit mirror failed (${ev.phase}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── HTTP plumbing ─────────────────────────────────────────────────

  private base(): string {
    return (this.config.apiUrl ?? '').replace(/\/+$/, '');
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.config.apiKey}` };
    if (this.config.sessionKey) h['X-Hermes-Session-Key'] = this.config.sessionKey;
    return h;
  }

  private async http(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; json: unknown } | { ok: false; detail: string; status?: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers: Record<string, string> = { ...this.authHeaders() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(`${this.base()}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.recordFailure(`HTTP ${res.status}`);
        return { ok: false, detail: `HTTP ${res.status} ${res.statusText}: ${truncate(text, 300)}`, status: res.status };
      }
      this.lastReachableAt = Date.now();
      return { ok: true, json: safeJson(text) ?? {} };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const detail = isAbort ? `timeout after ${this.config.timeoutMs}ms` : (err instanceof Error ? err.message : String(err));
      this.recordFailure(detail);
      return { ok: false, detail };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordFailure(reason: string): void {
    this.lastFailureAt = Date.now();
    this.lastFailureReason = reason;
  }

  getStatus(): { name: string; configured: boolean; healthy: boolean; url: string | null; lastFailureReason: string | null } {
    return {
      name: this.name,
      configured: this.available,
      healthy: this.healthy,
      url: this.config.apiUrl ?? null,
      lastFailureReason: this.lastFailureReason,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function safeJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

/** Pull the first present string-ish field from an object by key aliases. */
function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (v && typeof v === 'object') return JSON.stringify(v);
  }
  return undefined;
}

/**
 * Render a MirrorEvent into the Telegram audit-mirror text (Kern R3 format).
 * Shared by the Gateway wiring and the smoke test so the audit feed is
 * byte-identical wherever it originates. Run ids are wrapped in backticks so
 * their underscores don't trip Markdown parsing.
 */
export function renderMirrorEvent(ev: MirrorEvent): string {
  if (ev.phase === 'task') {
    return `📋 *TASK* \`${ev.runId ?? '—'}\`\n🔧 Tools: ${ev.tools.join(', ')}\n${ev.goal ?? ''}`;
  }
  if (ev.phase === 'approval_denied') {
    return `⚠️ *APPROVAL DENIED* \`${ev.runId ?? '—'}\`\nTool: ${ev.tool ?? 'unknown'}\nInput: ${ev.input ?? ''}\nAction: DENIED (default policy)`;
  }
  return `${ev.ok ? '✅' : '❌'} *RESULT* \`${ev.runId ?? '—'}\`\n${ev.ok ? (ev.summary ?? '') : (ev.error ?? '')}\n⏱ ${ev.elapsedMs ?? 0}ms`;
}

/** Parse a single SSE frame into its `event:` name and concatenated `data:`. */
function parseSseFrame(frame: string): { event?: string; data: string } {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const raw of frame.split(/\r?\n/)) {
    if (raw.startsWith('event:')) event = raw.slice(6).trim();
    else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).trim());
  }
  return { event, data: dataLines.join('\n') };
}

/**
 * Hermes Bridge — Pattern B integration with Nous Research's hermes-agent.
 *
 * The Consciousness Gateway provides a thin perception+intention+dharma layer
 * but a starved action surface (notify / reflect / observe). Hermes provides
 * an enormously wide action surface (40+ tools, 6 sandboxes, 6 channels,
 * skills, cron, MCP) but no dharma layer. This module is the conduit.
 *
 * From `CLAUDE.md` §1.3, two conscious agents that interact compose into a
 * larger agent: C_gateway ⊗ C_hermes = C_3. The bridge is precisely this
 * composition — the gateway's decision kernel D_g feeds Hermes' action
 * kernel A_h, while Hermes' percept stream feeds back into the gateway's
 * perception kernel P_g.
 *
 * Transport: MCP over HTTP using JSON-RPC 2.0. Talks to any Hermes instance
 * that exposes `mcp_serve.py` on a reachable URL. Zero new npm dependencies
 * — we use Node 18+ global `fetch`.
 *
 * Safety: every Hermes call is dispatched through the gateway's existing
 * `ActionExecutor` so it passes the dharma + ethos gate before leaving.
 * No Hermes action escapes the watchdog.
 *
 * Graceful degradation: when no Hermes URL is configured, every method
 * returns a structured `unavailable` result instead of throwing — the loop
 * keeps ticking and intentions targeting Hermes simply fail authorization.
 */

import { DelegationBounds, DelegationOutcome } from '../../consciousness/types';

// ─── Delegation Transport (Gateway = mind, Hermes = body) ────────────

/**
 * The boundary the Gateway crosses to reach Hermes' body. The Gateway hands
 * a bounded GOAL across; Hermes' agent loop chooses the means. Keeping this
 * an interface (not a concrete bridge) lets the executor be tested with a
 * mock, and lets the real transport be swapped/verified independently.
 *
 * NOTE: the concrete tool/transport mapping (which Hermes MCP tool carries
 * the goal, and how the result is polled back) MUST be verified against the
 * actual `hermes mcp serve` schema on the deployment host. Hermes' real MCP
 * surface is stdio + messaging-shaped; do not assume an `agent.run` HTTP tool.
 */
export interface HermesDelegator {
  delegate(goal: string, bounds: DelegationBounds, context?: string): Promise<DelegationOutcome>;
}

// ─── Public Types ────────────────────────────────────────────────────

/**
 * A Hermes-side capability the gateway can dispatch an intention into.
 *
 * The bridge maps each capability to an MCP tool name. Defaults match the
 * conventional Hermes naming; override per-deployment via `HermesBridgeConfig.toolMap`.
 */
export type HermesCapability =
  | 'spawn_subagent'   // Parallel subagent run (Modal, Daytona, Docker, ...)
  | 'run_skill'        // Execute a curated Hermes skill by name
  | 'run_tool'         // Direct tool call (shell, file, etc.) — highest dharma bar
  | 'send_channel'     // Outbound message on any Hermes channel
  | 'schedule_cron'    // Long-horizon scheduled task
  | 'memory_search'    // FTS5 / Honcho memory query (read-only — low bar)
  | 'list_skills'      // Enumerate available skills (read-only)
  | 'list_tools';      // Enumerate available tools (read-only)

export interface HermesBridgeConfig {
  /** MCP-over-HTTP endpoint of a running Hermes instance.
   *  e.g. `http://localhost:7821/mcp` — leave undefined to disable the bridge. */
  url?: string;
  /** Bearer token / API key for Hermes (optional). */
  authToken?: string;
  /** Override tool names per-capability when a Hermes deployment uses
   *  custom naming. Defaults provided below. */
  toolMap?: Partial<Record<HermesCapability, string>>;
  /** Per-call timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Delegation channel target — the `"platform:chat_id"` string a running
   *  Hermes AGENT watches and treats as a task queue. Hermes' real delegation
   *  surface is `messages_send(target, message)` → agent reply observed via
   *  `events_wait`. Env: `HERMES_DELEGATION_TARGET`. Delegation is disabled
   *  (returns a clear error) until this is set. */
  delegationTarget?: string;
  /** Optional session_key scoping `events_poll`/`events_wait` to the delegation
   *  conversation (from Hermes' `conversations_list`). When omitted, events are
   *  read unscoped. Env: `HERMES_DELEGATION_SESSION_KEY`. */
  delegationSessionKey?: string;
  /** Serialize outbound JSON-RPC so only one request is in flight at a time
   *  over the session's stdio pipe — guarantees strict request/response
   *  pairing through agentgateway. Default true. Set false only if a future
   *  transport safely supports pipelining. */
  serializeRequests?: boolean;
}

export interface HermesToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export type HermesCallResult =
  | { ok: true; content: string; raw: unknown }
  | { ok: false; reason: 'unavailable'; detail?: string }
  | { ok: false; reason: 'timeout'; detail?: string }
  | { ok: false; reason: 'error'; detail: string; status?: number };

const DEFAULT_TOOL_MAP: Record<HermesCapability, string> = {
  spawn_subagent: 'spawn_subagent',
  run_skill: 'run_skill',
  run_tool: 'run_tool',
  send_channel: 'send_message',
  schedule_cron: 'schedule_cron',
  memory_search: 'memory_search',
  list_skills: 'list_skills',
  list_tools: 'list_tools',
};

// ─── Bridge ──────────────────────────────────────────────────────────

export class HermesBridge implements HermesDelegator {
  readonly name = 'hermes';
  private readonly config: HermesBridgeConfig;
  private nextId = 1;
  private initialized = false;
  /** Streamable-HTTP session handle. Captured from the `Mcp-Session-Id`
   *  response header at initialize() and replayed on every subsequent call so
   *  the overlay routes us to the SAME spawned Hermes stdio process. Without
   *  it, send→poll races against an uninitialized/foreign stdio buffer. */
  private sessionId: string | null = null;
  /** Session-lifecycle telemetry (Kern's visibility ask). A new session id
   *  bumps `created`; a 404 on an established session bumps `expired`
   *  (an orphaned poll). Surfaced via getStatus(). */
  private sessionCreatedCount = 0;
  private sessionExpiredCount = 0;
  private sessionEstablishedAt = 0;
  /** Single-flight chain enforcing strict request/response pairing. */
  private requestChain: Promise<void> = Promise.resolve();
  private cachedTools: HermesToolDescriptor[] | null = null;
  private lastReachableAt = 0;
  private lastFailureAt = 0;
  private lastFailureReason: string | null = null;

  constructor(config?: HermesBridgeConfig) {
    this.config = {
      url: process.env.HERMES_MCP_URL,
      authToken: process.env.HERMES_AUTH_TOKEN,
      delegationTarget: process.env.HERMES_DELEGATION_TARGET,
      delegationSessionKey: process.env.HERMES_DELEGATION_SESSION_KEY,
      timeoutMs: 30_000,
      serializeRequests: true,
      ...(config ?? {}),
    };
  }

  /** True only when a URL is configured. Reachability is checked lazily. */
  get available(): boolean {
    return !!this.config.url;
  }

  /** Has the bridge successfully spoken to Hermes at least once this session? */
  get healthy(): boolean {
    return this.lastReachableAt > 0 && this.lastReachableAt > this.lastFailureAt;
  }

  // ─── MCP Lifecycle ─────────────────────────────────────────────────

  /**
   * Negotiate the MCP handshake. Idempotent and safe to call repeatedly.
   * Falls through silently when the bridge is disabled.
   */
  async initialize(): Promise<HermesCallResult> {
    if (!this.available) {
      return { ok: false, reason: 'unavailable', detail: 'HERMES_MCP_URL not set' };
    }
    if (this.initialized) {
      return { ok: true, content: 'already initialized', raw: null };
    }

    const result = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      clientInfo: { name: 'consciousness-gateway', version: '0.3.0' },
    });

    if (result.ok) {
      this.initialized = true;
      // MCP handshake completion — Streamable HTTP servers (incl. agentgateway)
      // require this notification before tools/list and tools/call are served.
      // Best-effort: the session is already usable if this is dropped.
      await this.rpc('notifications/initialized', undefined);
    }
    return result;
  }

  /**
   * Discover what tools Hermes is currently advertising. Cached after first
   * success; call `refreshTools()` to invalidate.
   */
  async listTools(): Promise<HermesToolDescriptor[] | null> {
    if (this.cachedTools) return this.cachedTools;
    if (!this.available) return null;

    const init = await this.initialize();
    if (!init.ok) return null;

    const result = await this.rpc('tools/list', {});
    if (!result.ok) return null;

    const raw = result.raw as { tools?: unknown[] } | undefined;
    if (!raw || !Array.isArray(raw.tools)) return null;

    this.cachedTools = raw.tools
      .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
      .map(t => ({
        name: String(t.name ?? ''),
        description: typeof t.description === 'string' ? t.description : undefined,
        inputSchema:
          typeof t.inputSchema === 'object' && t.inputSchema !== null
            ? (t.inputSchema as Record<string, unknown>)
            : undefined,
      }))
      .filter(t => t.name.length > 0);

    return this.cachedTools;
  }

  refreshTools(): void {
    this.cachedTools = null;
  }

  // ─── Generic Tool Invocation ───────────────────────────────────────

  /**
   * Call an arbitrary MCP tool on Hermes by name. Use this for tools the
   * bridge doesn't have a convenience method for.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<HermesCallResult> {
    if (!this.available) {
      return { ok: false, reason: 'unavailable', detail: 'HERMES_MCP_URL not set' };
    }

    const init = await this.initialize();
    if (!init.ok) return init;

    const result = await this.rpc('tools/call', { name, arguments: args });
    if (!result.ok) return result;

    return { ok: true, content: extractContent(result.raw), raw: result.raw };
  }

  // ─── Convenience Methods (Capability → Tool) ───────────────────────

  /**
   * Spawn an isolated Hermes subagent that runs an objective in its own
   * sandbox. This is the highest-bandwidth outlet for the consciousness
   * loop — long-horizon work that doesn't block the 1s tick.
   */
  spawnSubagent(args: { objective: string; sandbox?: string; toolset?: string[]; context?: string }): Promise<HermesCallResult> {
    return this.invokeCapability('spawn_subagent', args as unknown as Record<string, unknown>);
  }

  /**
   * Execute a named Hermes skill — a curated, dharma-reviewed procedural
   * memory. Lower-risk than `runTool` because skills are pre-vetted.
   */
  runSkill(args: { skill: string; input?: Record<string, unknown> }): Promise<HermesCallResult> {
    return this.invokeCapability('run_skill', args as unknown as Record<string, unknown>);
  }

  /**
   * Direct tool invocation (shell, file write, web fetch, ...).
   * Highest dharma bar — these can touch the world without a skill wrapper.
   */
  runTool(args: { tool: string; input?: Record<string, unknown> }): Promise<HermesCallResult> {
    return this.invokeCapability('run_tool', args as unknown as Record<string, unknown>);
  }

  /**
   * Send a message out on a Hermes channel (Telegram / Discord / Slack /
   * WhatsApp / Signal / Email / CLI). Outbound user-facing speech — this
   * is where Layer-2 ethos validation matters most.
   */
  sendChannel(args: { channel: string; recipient?: string; content: string }): Promise<HermesCallResult> {
    return this.invokeCapability('send_channel', args as unknown as Record<string, unknown>);
  }

  /**
   * Register a cron entry with Hermes so the gateway can form long-horizon
   * intentions ("revisit this weekly") without holding state itself.
   */
  scheduleCron(args: { cron: string; objective: string; channel?: string }): Promise<HermesCallResult> {
    return this.invokeCapability('schedule_cron', args as unknown as Record<string, unknown>);
  }

  /** Query Hermes' session memory (FTS5 + Honcho). Read-only — low bar. */
  memorySearch(args: { query: string; limit?: number }): Promise<HermesCallResult> {
    return this.invokeCapability('memory_search', args as unknown as Record<string, unknown>);
  }

  // ─── Delegation (HermesDelegator) ──────────────────────────────────

  /**
   * Delegate a bounded goal to Hermes' agent loop (Gateway = mind, Hermes =
   * body). The Gateway supplies the what/why; Hermes selects the means.
   *
   * Transport (verified against `NousResearch/hermes-agent` `mcp_serve.py`):
   * the embedded MCP surface is MESSAGING-shaped, not an `agent.run` endpoint.
   * Delegation is therefore a send→poll round-trip over a dedicated channel a
   * running Hermes AGENT watches as a task queue:
   *
   *   1. Snapshot the event cursor so we only read replies AFTER our send.
   *   2. `messages_send(target, message)` — the goal + bounds, carrying a unique
   *      correlation token so we can distinguish the agent's reply from the
   *      echo of our own message WITHOUT depending on Hermes' (deployment-
   *      specific) event direction/role field names (§8 Q3 of the verification
   *      plan recommends exactly this token fallback).
   *   3. `events_wait(after_cursor, session_key?, timeout_ms)` in a loop until
   *      the bound's deadline; the first inbound message that is NOT our own
   *      echo is the result.
   *
   * Runs OFF the 1s tick (executor fires it in the background), so the blocking
   * wait here never stalls the consciousness loop. Every failure mode preserves
   * its reason verbatim for the gateway's failure-transparency percept (Cond 4).
   *
   * Live-host note: tool NAMES are confirmed; the exact event/cursor FIELD names
   * are tolerant-parsed (see helpers) and the token is the primary correlation
   * key, so this works without re-confirming the schema. §1 of the plan can
   * still tighten field extraction once introspected on the Mac mini.
   */
  async delegate(goal: string, bounds: DelegationBounds, context?: string): Promise<DelegationOutcome> {
    if (!this.available) {
      return { ok: false, error: 'Hermes delegator not configured (HERMES_MCP_URL unset)' };
    }
    const target = this.config.delegationTarget;
    if (!target) {
      return { ok: false, error: 'Hermes delegation target unset (HERMES_DELEGATION_TARGET)' };
    }
    const session = this.config.delegationSessionKey;
    const sessionArg = session ? { session_key: session } : {};

    // 1. Snapshot the cursor — only replies after this point count as ours.
    const poll0 = await this.callTool('events_poll', { ...sessionArg, after_cursor: 0, limit: 1 });
    if (!poll0.ok) {
      return { ok: false, error: `${poll0.reason}${poll0.detail ? ': ' + poll0.detail : ''}` };
    }
    let cursor = extractCursor(poll0.raw) ?? 0;

    // 2. Send the goal. Bounds ride in the text so the agent knows the success
    //    criteria + budget; the token lets us skip our own echo in step 3.
    const token = correlationToken();
    const message =
      `TASK [${token}]: ${goal}\n` +
      `SUCCESS CRITERIA: ${bounds.successCriteria}\n` +
      `TIME LIMIT: ${Math.round(bounds.timeLimitMs / 1000)}s` +
      (bounds.maxResourceUnits ? `\nRESOURCE LIMIT: ${bounds.maxResourceUnits} units` : '') +
      (context ? `\nCONTEXT: ${context}` : '');

    const send = await this.callTool('messages_send', { target, message });
    if (!send.ok) {
      return { ok: false, error: `${send.reason}${send.detail ? ': ' + send.detail : ''}` };
    }

    // 3. Wait for the agent's reply, bounded by the delegation's time limit.
    const deadline = Date.now() + bounds.timeLimitMs;
    while (Date.now() < deadline) {
      // events_wait caps server-side at 5 min; never wait past our own deadline.
      const remaining = Math.min(deadline - Date.now(), 300_000);
      const res = await this.callTool('events_wait', {
        ...sessionArg,
        after_cursor: cursor,
        timeout_ms: remaining,
      });
      if (!res.ok) {
        // A transport timeout slice is benign — keep waiting until the deadline.
        if (res.reason === 'timeout') continue;
        return { ok: false, error: `${res.reason}${res.detail ? ': ' + res.detail : ''}` };
      }
      const events = extractEvents(res.raw);
      if (events.length === 0) continue; // server wait elapsed empty → loop
      cursor = maxCursor(events, cursor);
      const reply = pickAgentReply(events, token);
      if (reply) {
        const ref = session ? `${session}:${reply.cursor}` : String(reply.cursor);
        return { ok: true, summary: reply.text || 'delegation completed', hermesRef: ref };
      }
    }
    return { ok: false, error: `no agent reply within ${bounds.timeLimitMs}ms` };
  }

  // ─── Status ────────────────────────────────────────────────────────

  getStatus(): {
    name: string;
    configured: boolean;
    initialized: boolean;
    healthy: boolean;
    lastReachableAt: number;
    lastFailureAt: number;
    lastFailureReason: string | null;
    toolCount: number | null;
    url: string | null;
    sessionActive: boolean;
    sessionCreatedCount: number;
    sessionExpiredCount: number;
    sessionEstablishedAt: number;
  } {
    return {
      name: this.name,
      configured: this.available,
      initialized: this.initialized,
      healthy: this.healthy,
      lastReachableAt: this.lastReachableAt,
      lastFailureAt: this.lastFailureAt,
      lastFailureReason: this.lastFailureReason,
      toolCount: this.cachedTools?.length ?? null,
      url: this.config.url ?? null,
      sessionActive: this.sessionId !== null,
      sessionCreatedCount: this.sessionCreatedCount,
      sessionExpiredCount: this.sessionExpiredCount,
      sessionEstablishedAt: this.sessionEstablishedAt,
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private invokeCapability(
    capability: HermesCapability,
    args: Record<string, unknown>,
  ): Promise<HermesCallResult> {
    const name = this.config.toolMap?.[capability] ?? DEFAULT_TOOL_MAP[capability];
    return this.callTool(name, args);
  }

  /**
   * Public entry point. Serializes requests onto a single in-flight chain so
   * the stdio pipe that agentgateway pins per session never sees interleaved
   * calls — Hermes' request/response state machine stays strictly paired.
   * Out-of-order delivery (Kern's concern) is structurally prevented here, and
   * JSON-RPC `id` correlation handles it at the protocol level as a backstop.
   */
  private rpc(method: string, params: unknown): Promise<HermesCallResult> {
    if (this.config.serializeRequests === false) {
      return this.executeRpc(method, params);
    }
    const run = this.requestChain.then(() => this.executeRpc(method, params));
    // Keep the chain alive regardless of any single call's outcome.
    this.requestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async executeRpc(method: string, params: unknown): Promise<HermesCallResult> {
    if (!this.config.url) {
      return { ok: false, reason: 'unavailable', detail: 'no URL' };
    }

    const isNotification = method.startsWith('notifications/');
    const body = isNotification
      ? JSON.stringify({ jsonrpc: '2.0', method, params })
      : JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Streamable HTTP: the server may answer with a single JSON body OR an
        // SSE frame, so we must advertise both.
        Accept: 'application/json, text/event-stream',
      };
      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }
      // Replay the session handle so the overlay pins us to the same stdio proc.
      if (this.sessionId) {
        headers['Mcp-Session-Id'] = this.sessionId;
      }

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      // Capture/refresh the session handle from any response that carries it.
      const sid = response.headers.get('mcp-session-id');
      if (sid && sid !== this.sessionId) {
        this.sessionId = sid;
        this.sessionCreatedCount++;
        this.sessionEstablishedAt = Date.now();
      }

      if (!response.ok) {
        // 404 on a previously-good session means the overlay dropped/expired it.
        // Clear local session state so the next call re-initializes cleanly.
        if (response.status === 404 && this.sessionId) {
          this.sessionId = null;
          this.initialized = false;
          this.sessionExpiredCount++;
        }
        // A fire-and-forget notification must never drag the bridge unhealthy.
        if (!isNotification) {
          this.recordFailure(`HTTP ${response.status}`);
        }
        return {
          ok: false,
          reason: 'error',
          detail: `HTTP ${response.status} ${response.statusText}`,
          status: response.status,
        };
      }

      // Notifications carry no JSON-RPC response body (202 / empty) — done.
      if (isNotification) {
        this.lastReachableAt = Date.now();
        return { ok: true, content: '', raw: null };
      }

      const json = await this.parseRpcResponse(response);

      if (json.error) {
        this.recordFailure(json.error.message ?? 'rpc error');
        return {
          ok: false,
          reason: 'error',
          detail: `${json.error.code ?? ''} ${json.error.message ?? 'unknown'}`.trim(),
        };
      }

      this.lastReachableAt = Date.now();
      return { ok: true, content: '', raw: json.result };
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        if (!isNotification) this.recordFailure('timeout');
        return { ok: false, reason: 'timeout', detail: 'fetch aborted' };
      }
      const message = err instanceof Error ? err.message : String(err);
      if (!isNotification) this.recordFailure(message);
      return { ok: false, reason: 'error', detail: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse a JSON-RPC response that may be either a plain JSON body or a single
   * SSE frame (Streamable HTTP). For SSE we take the last `data:` line that
   * parses as JSON — that's the response object for our request id.
   */
  private async parseRpcResponse(response: Response): Promise<{
    jsonrpc?: string;
    id?: number;
    result?: unknown;
    error?: { code?: number; message?: string };
  }> {
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    if (contentType.includes('text/event-stream')) {
      const dataLines = text
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean);
      for (let i = dataLines.length - 1; i >= 0; i--) {
        try {
          return JSON.parse(dataLines[i]);
        } catch {
          /* keep scanning earlier frames */
        }
      }
      return {};
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }

  private recordFailure(reason: string): void {
    this.lastFailureAt = Date.now();
    this.lastFailureReason = reason;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * MCP tool results carry an array of content blocks. Concatenate the text
 * blocks into a flat string for the gateway's ActionResult outcome field.
 */
function extractContent(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const r = raw as { content?: unknown };
  if (!Array.isArray(r.content)) return '';

  const parts: string[] = [];
  for (const block of r.content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
    }
  }
  return parts.join('\n').trim();
}

// ─── Delegation round-trip helpers ───────────────────────────────────
//
// Hermes' `events_poll`/`events_wait` return their payload as MCP text content;
// the exact field names (cursor, event shape, direction marker) are deployment-
// specific, so every extractor below is deliberately tolerant of common aliases.

/** Short, unique token embedded in a delegated goal so the agent's reply can be
 *  told apart from the echo of our own sent message — independent of schema. */
function correlationToken(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** Unwrap an MCP tool result into its JSON payload. Hermes wraps the events
 *  JSON inside a `content[].text` block; fall back to the raw object/array. */
function unwrapPayload(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && Array.isArray((raw as { content?: unknown[] }).content)) {
    const text = extractContent(raw);
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return text; // plain-text reply, not JSON
      }
    }
  }
  return raw;
}

interface NormEvent {
  cursor: number;
  text: string;
  outbound: boolean;
  raw: Record<string, unknown>;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Pull a cursor value out of an events payload (next_cursor / nextCursor /
 *  cursor), else the largest per-event cursor seen. */
function extractCursor(raw: unknown): number | undefined {
  const p = unwrapPayload(raw);
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const o = p as Record<string, unknown>;
    const c = asNumber(o.next_cursor) ?? asNumber(o.nextCursor) ?? asNumber(o.cursor);
    if (c !== undefined) return c;
  }
  const evs = extractEvents(raw);
  return evs.length ? maxCursor(evs, 0) : undefined;
}

/** Normalize an events payload into a flat list of {cursor, text, outbound}. */
function extractEvents(raw: unknown): NormEvent[] {
  const p = unwrapPayload(raw);
  let list: unknown[] = [];
  if (Array.isArray(p)) {
    list = p;
  } else if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    if (Array.isArray(o.events)) list = o.events;
    else if (Array.isArray(o.data)) list = o.data as unknown[];
    else if (Array.isArray(o.messages)) list = o.messages;
  }
  const out: NormEvent[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const ev = e as Record<string, unknown>;
    const data = (ev.data && typeof ev.data === 'object' ? ev.data : ev) as Record<string, unknown>;
    const cursor =
      asNumber(ev.cursor) ?? asNumber(ev.id) ?? asNumber(ev.seq) ?? asNumber(ev.after_cursor) ?? 0;
    const text =
      pickString(data.text) ??
      pickString(data.message) ??
      pickString(data.content) ??
      pickString(ev.text) ??
      '';
    const dir = (pickString(data.direction) ?? pickString(data.role) ?? pickString(data.sender) ??
      pickString(data.from) ?? '').toLowerCase();
    const outbound =
      data.is_outbound === true || data.outbound === true ||
      dir === 'outbound' || dir === 'out' || dir === 'sent' || dir === 'user' || dir === 'self';
    out.push({ cursor, text, outbound, raw: ev });
  }
  return out;
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function maxCursor(events: NormEvent[], fallback: number): number {
  return events.reduce((m, e) => (e.cursor > m ? e.cursor : m), fallback);
}

/** The first inbound message that is NOT the echo of our own send (identified
 *  by the correlation token) — that is the agent's reply. */
function pickAgentReply(events: NormEvent[], token: string): { text: string; cursor: number } | null {
  for (const e of events) {
    if (e.outbound) continue;             // our own message direction
    if (e.text.includes(token)) continue; // echo of our send (token rides in it)
    if (!e.text) continue;                // non-message / empty event
    return { text: e.text, cursor: e.cursor };
  }
  return null;
}

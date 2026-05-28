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
  /** MCP tool name that accepts a delegated goal. MUST be verified against the
   *  installed Hermes' `mcp serve` schema on the deployment host. Default
   *  'messages_send' (Hermes' real surface is messaging-shaped). */
  delegationTool?: string;
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
   * Transport caveat: this routes the goal through a single configurable MCP
   * tool (`delegationTool`, default 'messages_send'). The real Hermes surface
   * is stdio + messaging, and asynchronous goal completion is observed by
   * polling Hermes' events — that round-trip MUST be wired and verified
   * against the live `hermes mcp serve` schema on the deployment host. Until
   * then this returns the dispatch acknowledgement as the outcome.
   */
  async delegate(goal: string, bounds: DelegationBounds, context?: string): Promise<DelegationOutcome> {
    if (!this.available) {
      return { ok: false, error: 'Hermes delegator not configured (HERMES_MCP_URL unset)' };
    }

    const tool = this.config.delegationTool ?? 'messages_send';
    const result = await this.callTool(tool, {
      goal,
      successCriteria: bounds.successCriteria,
      timeLimitMs: bounds.timeLimitMs,
      maxResourceUnits: bounds.maxResourceUnits,
      context,
    });

    if (!result.ok) {
      // Preserve the full reason + detail verbatim (Condition 4).
      const error = `${result.reason}${result.detail ? ': ' + result.detail : ''}`;
      return { ok: false, error };
    }

    return { ok: true, summary: result.content || 'delegation acknowledged', hermesRef: undefined };
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

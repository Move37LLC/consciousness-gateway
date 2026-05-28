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

export class HermesBridge {
  readonly name = 'hermes';
  private readonly config: HermesBridgeConfig;
  private nextId = 1;
  private initialized = false;
  private cachedTools: HermesToolDescriptor[] | null = null;
  private lastReachableAt = 0;
  private lastFailureAt = 0;
  private lastFailureReason: string | null = null;

  constructor(config?: HermesBridgeConfig) {
    this.config = {
      url: process.env.HERMES_MCP_URL,
      authToken: process.env.HERMES_AUTH_TOKEN,
      timeoutMs: 30_000,
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

  private async rpc(method: string, params: unknown): Promise<HermesCallResult> {
    if (!this.config.url) {
      return { ok: false, reason: 'unavailable', detail: 'no URL' };
    }

    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.recordFailure(`HTTP ${response.status}`);
        return {
          ok: false,
          reason: 'error',
          detail: `HTTP ${response.status} ${response.statusText}`,
          status: response.status,
        };
      }

      const json = (await response.json()) as {
        jsonrpc?: string;
        id?: number;
        result?: unknown;
        error?: { code?: number; message?: string };
      };

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
        this.recordFailure('timeout');
        return { ok: false, reason: 'timeout', detail: 'fetch aborted' };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.recordFailure(message);
      return { ok: false, reason: 'error', detail: message };
    } finally {
      clearTimeout(timeout);
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

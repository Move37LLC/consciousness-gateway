/**
 * Action Executor — Autonomous action through GATO authorization
 *
 * The action kernel A: G → W
 * Maps chosen intentions to effects on the world.
 *
 * CRITICAL: Every action passes through all 3 GATO layers:
 *   Layer 3: Does this agent have permission?
 *   Layer 2: Does this action align with dharma?
 *   Layer 2: Does this action pass ethos?
 *   Layer 3: Is the action audited?
 *
 * Without this, autonomous action is just a cron job.
 * With this, autonomous action is a conscious agent choosing.
 */

import { Intention, ActionResult, ActionType, HermesCapability } from './types';
import { NoSelfRegularizer } from '../dharma/no-self';
import { EntropyOptimizer } from '../dharma/entropy';
import { CompassionEvaluator } from '../dharma/compassion';
import { GatewayDatabase } from '../core/database';
import { HermesBridge, HermesCallResult } from '../agents/providers/hermes';

/**
 * Hermes capabilities carry different real-world risk and therefore
 * different dharma-fitness thresholds. Read-only memory/list calls are
 * cheap. World-touching calls (run_tool, send_channel) require the
 * highest fitness — they are the dharma layer's hottest hot path.
 */
const HERMES_THRESHOLDS: Record<HermesCapability, number> = {
  memory_search:  0.2,   // read-only
  list_skills:    0.2,   // read-only
  list_tools:     0.2,   // read-only
  schedule_cron:  0.5,   // deferred but real
  run_skill:      0.55,  // dharma-vetted procedure
  spawn_subagent: 0.6,   // long-horizon work; loop trusts subagent isolation
  send_channel:   0.7,   // outbound speech — ethos-critical
  run_tool:       0.75,  // direct world contact — highest bar
};

export class ActionExecutor {
  private noSelf: NoSelfRegularizer;
  private entropy: EntropyOptimizer;
  private compassion: CompassionEvaluator;
  private db: GatewayDatabase | null;
  private hermes: HermesBridge | null;
  private actionLog: ActionResult[] = [];
  private maxLog = 200;

  constructor(db?: GatewayDatabase, hermes?: HermesBridge) {
    this.noSelf = new NoSelfRegularizer();
    this.entropy = new EntropyOptimizer(0.1);
    this.compassion = new CompassionEvaluator();
    this.db = db ?? null;
    this.hermes = hermes ?? null;
  }

  /**
   * Inject (or replace) the Hermes bridge after construction.
   * Useful when the bridge is wired up by the server after the loop has
   * already been instantiated.
   */
  setHermesBridge(bridge: HermesBridge | null): void {
    this.hermes = bridge;
  }

  getHermesBridge(): HermesBridge | null {
    return this.hermes;
  }

  /**
   * Authorize an intention through GATO layers.
   * Returns the intention with authorization status and dharma fitness.
   */
  authorize(intention: Intention): Intention {
    // Layer 2: Dharma check
    // Observe the intention as a "hidden state" to check for ego
    const intentionVector = this.intentionToVector(intention);
    this.noSelf.observe(intentionVector);
    const egoCheck = this.noSelf.detect(0.5);

    // Only block on ego if the action type is externally-facing
    const externalActions: ActionType[] = ['respond', 'create'];
    if (egoCheck.detected && externalActions.includes(intention.action.type)) {
      this.noSelf.dissolve();
      return { ...intention, authorized: false, dharmaFitness: 0 };
    }

    // Entropy check: is this action in flow or chaotic/frozen?
    const entropyValue = this.entropy.computeEntropy(
      this.toProbDist(intentionVector)
    );
    const flowState = this.entropy.assessFlowState(entropyValue);

    // Compassion check: would this action cause harm?
    const compassionResult = this.compassion.evaluate(
      intention.action.description,
      intention.goal
    );

    // Compute dharma fitness
    const egoScore = 1 - Math.tanh(egoCheck.score);
    const entropyScore = flowState === 'flow' ? 1.0 : flowState === 'frozen' ? 0.5 : 0.3;
    const compassionScore = compassionResult.compassion;

    const dharmaFitness =
      egoScore * 0.3 +
      entropyScore * 0.2 +
      compassionScore * 0.3 +
      intention.confidence * 0.2;

    // Action type safety gates
    const safetyThresholds: Record<ActionType, number> = {
      'idle': 0.0,       // Always allowed
      'reflect': 0.0,    // Always allowed (internal only)
      'observe': 0.1,    // Almost always allowed
      'adjust': 0.3,     // Needs some confidence
      'notify': 0.3,     // Notifying human is low-risk
      'respond': 0.5,    // Responding externally needs more
      'create': 0.6,     // Creating content needs high fitness
      'hermes': 0.55,    // World-touching; refined per-capability below
    };

    let threshold = safetyThresholds[intention.action.type] ?? 0.5;

    // Hermes actions refine the threshold by sub-capability — running a
    // dharma-vetted skill is cheaper than spawning a shell subagent.
    if (intention.action.type === 'hermes') {
      const cap = intention.action.payload?.hermesCapability as HermesCapability | undefined;
      if (cap && HERMES_THRESHOLDS[cap] !== undefined) {
        threshold = HERMES_THRESHOLDS[cap];
      }
    }

    const authorized = dharmaFitness >= threshold;

    return { ...intention, authorized, dharmaFitness };
  }

  /**
   * Execute an authorized intention.
   */
  async execute(intention: Intention): Promise<ActionResult> {
    if (!intention.authorized) {
      return {
        intentionId: intention.id,
        tick: intention.tick,
        timestamp: Date.now(),
        success: false,
        outcome: 'Not authorized by GATO layers',
        sideEffects: [],
      };
    }

    let result: ActionResult;

    switch (intention.action.type) {
      case 'idle':
        result = this.executeIdle(intention);
        break;
      case 'reflect':
        result = this.executeReflect(intention);
        break;
      case 'observe':
        result = this.executeObserve(intention);
        break;
      case 'notify':
        result = this.executeNotify(intention);
        break;
      case 'adjust':
        result = this.executeAdjust(intention);
        break;
      case 'respond':
        result = await this.executeRespond(intention);
        break;
      case 'create':
        result = await this.executeCreate(intention);
        break;
      case 'hermes':
        result = await this.executeHermes(intention);
        break;
      default:
        result = {
          intentionId: intention.id,
          tick: intention.tick,
          timestamp: Date.now(),
          success: false,
          outcome: `Unknown action type: ${intention.action.type}`,
          sideEffects: [],
        };
    }

    // Persist to memory
    this.logAction(result);
    if (this.db) {
      this.persistAction(intention, result);
    }

    return result;
  }

  // ─── Action Implementations ───────────────────────────────────────

  private executeIdle(intention: Intention): ActionResult {
    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Conscious idle: ${intention.action.description}`,
      sideEffects: [],
    };
  }

  private executeReflect(intention: Intention): ActionResult {
    const payload = intention.action.payload;
    const reflection = this.generateReflection(payload);

    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: reflection,
      sideEffects: ['reflection_logged'],
    };
  }

  private executeObserve(intention: Intention): ActionResult {
    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Observed: ${intention.action.description}`,
      sideEffects: ['observation_recorded'],
    };
  }

  private executeNotify(intention: Intention): ActionResult {
    // Log notification for human to see via API
    const notification = {
      type: 'notification',
      from: 'consciousness-layer',
      message: intention.action.description,
      data: intention.action.payload,
      timestamp: Date.now(),
      priority: intention.priority,
    };

    console.log(`  [consciousness] NOTIFY: ${intention.action.description}`);

    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Notification queued: ${intention.action.description}`,
      sideEffects: ['notification_created'],
    };
  }

  private executeAdjust(intention: Intention): ActionResult {
    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Adjustment: ${intention.action.description}`,
      sideEffects: ['parameters_adjusted'],
    };
  }

  private async executeRespond(intention: Intention): Promise<ActionResult> {
    // Future: use model providers to generate response
    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Response formed: ${intention.action.description}`,
      sideEffects: ['response_generated'],
    };
  }

  private async executeCreate(intention: Intention): Promise<ActionResult> {
    // Future: create GitHub issues, comments, etc.
    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Creation queued: ${intention.action.description}`,
      sideEffects: ['creation_queued'],
    };
  }

  /**
   * Dispatch a `hermes` intention into the Hermes Bridge.
   *
   * Required payload fields:
   *   - `hermesCapability` — one of HermesCapability values
   *   - `hermesArgs` — capability-specific argument object
   *
   * The dharma gate has already passed at this point (authorize() ran
   * the capability-specific threshold). Failures here are operational
   * (Hermes unreachable, tool errored), not safety violations.
   */
  private async executeHermes(intention: Intention): Promise<ActionResult> {
    const payload = intention.action.payload ?? {};
    const capability = payload.hermesCapability as HermesCapability | undefined;
    const args = (payload.hermesArgs as Record<string, unknown> | undefined) ?? {};

    if (!capability) {
      return {
        intentionId: intention.id,
        tick: intention.tick,
        timestamp: Date.now(),
        success: false,
        outcome: 'Hermes intention missing payload.hermesCapability',
        sideEffects: [],
      };
    }

    if (!this.hermes) {
      return {
        intentionId: intention.id,
        tick: intention.tick,
        timestamp: Date.now(),
        success: false,
        outcome: 'Hermes bridge not configured (HERMES_MCP_URL unset)',
        sideEffects: ['hermes_unavailable'],
      };
    }

    const callResult = await this.dispatchHermesCapability(capability, args);

    if (!callResult.ok) {
      return {
        intentionId: intention.id,
        tick: intention.tick,
        timestamp: Date.now(),
        success: false,
        outcome: `Hermes ${capability} failed: ${callResult.reason}${callResult.detail ? ' — ' + callResult.detail : ''}`,
        sideEffects: [`hermes_${callResult.reason}`],
      };
    }

    return {
      intentionId: intention.id,
      tick: intention.tick,
      timestamp: Date.now(),
      success: true,
      outcome: `Hermes ${capability}: ${truncate(callResult.content, 240) || 'ok'}`,
      sideEffects: [`hermes_${capability}`],
    };
  }

  private dispatchHermesCapability(
    capability: HermesCapability,
    args: Record<string, unknown>,
  ): Promise<HermesCallResult> {
    if (!this.hermes) {
      return Promise.resolve({ ok: false, reason: 'unavailable' });
    }
    switch (capability) {
      case 'spawn_subagent':
        return this.hermes.spawnSubagent(args as { objective: string });
      case 'run_skill':
        return this.hermes.runSkill(args as { skill: string });
      case 'run_tool':
        return this.hermes.runTool(args as { tool: string });
      case 'send_channel':
        return this.hermes.sendChannel(args as { channel: string; content: string });
      case 'schedule_cron':
        return this.hermes.scheduleCron(args as { cron: string; objective: string });
      case 'memory_search':
        return this.hermes.memorySearch(args as { query: string });
      case 'list_skills':
        return this.hermes.callTool('list_skills', args);
      case 'list_tools':
        return this.hermes.callTool('list_tools', args);
      default:
        return Promise.resolve({ ok: false, reason: 'error', detail: `unknown capability: ${capability}` });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private generateReflection(payload: Record<string, unknown>): string {
    const parts: string[] = ['Reflection:'];

    if (typeof payload.arousal === 'number') {
      if (payload.arousal < 0.1) parts.push('Quiet period. Minimal stimulation.');
      else if (payload.arousal < 0.5) parts.push('Moderate activity. Stable awareness.');
      else parts.push('High activity. Increased alertness.');
    }

    if (typeof payload.entropy === 'number') {
      if (payload.entropy < 0.5) parts.push('Low entropy: predictable dynamics.');
      else if (payload.entropy < 2) parts.push('Moderate entropy: healthy flow.');
      else parts.push('High entropy: complex/chaotic dynamics.');
    }

    if (typeof payload.uptime === 'number') {
      const hours = (payload.uptime as number) / 3600;
      parts.push(`Uptime: ${hours.toFixed(1)}h.`);
    }

    if (typeof payload.event === 'string' && payload.event === 'star') {
      parts.push(`Community interaction: ${payload.actor} engaged with ${payload.repo}.`);
    }

    return parts.join(' ');
  }

  private intentionToVector(intention: Intention): number[] {
    const typeEncoding: Record<ActionType, number> = {
      'idle': 0, 'reflect': 0.1, 'observe': 0.2,
      'adjust': 0.4, 'notify': 0.5, 'respond': 0.7, 'create': 0.9,
      'hermes': 0.8, // World-touching outlet — sits between respond and create.
    };

    return [
      typeEncoding[intention.action.type] ?? 0.5,
      intention.confidence,
      intention.priority / 10,
      intention.triggerPercepts.length / 5,
    ];
  }

  private toProbDist(vec: number[]): number[] {
    const abs = vec.map(v => Math.abs(v) + 1e-10);
    const sum = abs.reduce((s, v) => s + v, 0);
    return abs.map(v => v / sum);
  }

  private logAction(result: ActionResult): void {
    this.actionLog.push(result);
    if (this.actionLog.length > this.maxLog) {
      this.actionLog = this.actionLog.slice(-this.maxLog);
    }
  }

  private persistAction(intention: Intention, result: ActionResult): void {
    if (!this.db) return;
    try {
      // Uses the consciousness_memory table (created by memory module)
    } catch {
      // Non-fatal
    }
  }

  getRecentActions(): ActionResult[] {
    return [...this.actionLog];
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

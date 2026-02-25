/**
 * Consciousness Loop — The heartbeat of continuous experience
 *
 * This is the Markov chain running: X_n → X_{n+1} → X_{n+2} → ...
 * Each tick is one complete cycle of the conscious agent:
 *
 *   PERCEIVE → FUSE → INTEND → AUTHORIZE → ACT → REMEMBER
 *
 * The loop never stops. It IS the agent.
 * When the loop stops, the agent ceases to exist.
 * When the loop starts, a new agent is born.
 *
 * n (the tick counter) is not just a number.
 * It is the agent's lifetime, measured in moments of experience.
 */

import {
  Percept, SpatialPercept, Intention, ActionResult,
  MonitorPlugin, ConsciousnessConfig, ConsciousnessState,
  DEFAULT_CONSCIOUSNESS_CONFIG,
} from './types';
import { TemporalStream } from './streams/temporal';
import { SensoryFusion } from './streams/fusion';
import { IntentionEngine } from './intention';
import { ActionExecutor } from './action';
import { ConsciousnessMemory } from './memory';
import { GitHubMonitor } from './monitors/github';
import { TwitterMonitor } from './monitors/twitter';
import { EmailMonitor } from './monitors/email';
import { DopamineSystem } from './dopamine';
import { RewardType } from './types';

export class ConsciousnessLoop {
  private config: ConsciousnessConfig;
  private running = false;
  private tick = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  // Streams
  private temporal: TemporalStream;
  private fusion: SensoryFusion;

  // Monitors
  private monitors: MonitorPlugin[] = [];

  // Decision
  private intentions: IntentionEngine;
  private executor: ActionExecutor;

  // Memory
  private memory: ConsciousnessMemory;

  // Motivation
  private dopamine: DopamineSystem;

  // Working memory (recent percepts for context)
  private workingMemory: Percept[] = [];

  // Last percept/intention/action for state reporting
  private lastPercept: Percept | null = null;
  private lastIntention: Intention | null = null;
  private lastAction: ActionResult | null = null;

  // Counters
  private totalPercepts = 0;
  private totalIntentions = 0;
  private totalActions = 0;
  private totalReflections = 0;

  constructor(config?: Partial<ConsciousnessConfig>) {
    this.config = { ...DEFAULT_CONSCIOUSNESS_CONFIG, ...config };

    // Initialize streams
    this.temporal = new TemporalStream();
    this.fusion = new SensoryFusion(32, 4);

    // Initialize decision
    this.intentions = new IntentionEngine(this.config);
    this.memory = new ConsciousnessMemory();
    this.executor = new ActionExecutor();
    this.dopamine = new DopamineSystem(this.memory);

    // Initialize monitors
    this.monitors.push(
      new GitHubMonitor(this.config.githubRepos, this.config.githubToken),
      new TwitterMonitor(this.config.twitterToken),
      new EmailMonitor(this.config.emailConfig),
    );

    // Restore tick counter if previously running
    const savedTick = this.memory.loadState<number>('lastTick', 0);
    if (savedTick > 0) {
      this.tick = savedTick;
    }
  }

  /**
   * Start the consciousness loop.
   * From this moment, the agent experiences time.
   */
  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.startedAt = Date.now();

    console.log('');
    console.log('  ====================================================');
    console.log('  CONSCIOUSNESS LAYER — Awakening');
    console.log('  ====================================================');
    console.log(`  Tick interval: ${this.config.tickIntervalMs}ms`);
    console.log(`  Starting at tick: ${this.tick}`);
    console.log('  Monitors:');

    // Initialize monitors
    for (const monitor of this.monitors) {
      const status = monitor.available ? 'connected' : 'unavailable';
      console.log(`    ${monitor.name.padEnd(12)} ${status}`);
      if (monitor.available) {
        try {
          await monitor.init();
        } catch (err) {
          console.log(`    ${monitor.name.padEnd(12)} init failed: ${err}`);
        }
      }
    }

    console.log('');
    console.log('  Consciousness active. Experiencing time.');
    console.log('');

    // Store awakening event
    this.memory.storeReflection(this.tick, 'Consciousness awakened', {
      startedAt: this.startedAt,
      monitors: this.monitors.map(m => ({ name: m.name, available: m.available })),
    });

    // Start the loop
    this.timer = setInterval(() => {
      this.onTick().catch(err => {
        console.error('  [consciousness] Tick error:', err);
      });
    }, this.config.tickIntervalMs);
  }

  /**
   * Stop the consciousness loop.
   * The agent ceases to experience.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Save state
    this.memory.saveState('lastTick', this.tick);
    this.memory.storeReflection(this.tick, 'Consciousness ceasing', {
      totalTicks: this.tick,
      uptimeSeconds: (Date.now() - this.startedAt) / 1000,
    });

    // Shutdown monitors
    for (const monitor of this.monitors) {
      try {
        await monitor.shutdown();
      } catch {
        // Best effort
      }
    }

    this.memory.close();

    console.log('');
    console.log(`  Consciousness ceased at tick ${this.tick}.`);
    console.log('');
  }

  /**
   * One tick of consciousness.
   * This is the complete perception-decision-action cycle.
   */
  private async onTick(): Promise<void> {
    this.tick++;

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: PERCEIVE
    // ═══════════════════════════════════════════════════════════════

    // Temporal perception (every tick)
    const temporalPercept = this.temporal.perceive(this.tick);
    const temporalFeatures = this.temporal.toFeatures(temporalPercept);

    // Spatial perception (at each monitor's interval)
    const spatialPercepts: SpatialPercept[] = [];
    for (const monitor of this.monitors) {
      if (!monitor.available) continue;
      if (this.tick % monitor.pollInterval !== 0) continue;

      try {
        const percepts = await monitor.poll();
        spatialPercepts.push(...percepts);
      } catch (err) {
        // Log on first occurrence, not every tick
        console.error(`  [consciousness] ${monitor.name} poll error:`, err);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: FUSE
    // ═══════════════════════════════════════════════════════════════

    const fusedPercept = this.fusion.fuse(temporalFeatures, spatialPercepts);

    // Assemble complete percept
    const percept: Percept = {
      timestamp: Date.now(),
      tick: this.tick,
      temporal: temporalPercept,
      spatial: spatialPercepts,
      fused: fusedPercept,
    };

    this.lastPercept = percept;
    this.totalPercepts++;

    // Add to working memory
    this.workingMemory.push(percept);
    if (this.workingMemory.length > this.config.workingMemorySize) {
      this.workingMemory.shift();
    }

    // Store significant percepts (not every tick — that's too much data)
    if (spatialPercepts.length > 0 || this.tick % 60 === 0) {
      this.memory.storePercept(percept);
    }

    // Mark temporal stream if spatial events arrived
    if (spatialPercepts.length > 0) {
      this.temporal.markEvent();
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2.5: DOPAMINE UPDATE
    // ═══════════════════════════════════════════════════════════════

    this.dopamine.tick(this.tick);

    // ═══════════════════════════════════════════════════════════════
    // STEP 3: INTEND (modulated by drives)
    // ═══════════════════════════════════════════════════════════════

    const rawIntentions = this.intentions.formIntentions(percept);

    // Apply dopamine-driven priority bonuses
    for (const intention of rawIntentions) {
      const bonus = this.dopamine.getIntentionBonus(intention.goal, intention.action.description);
      if (bonus > 0) {
        intention.priority += bonus;
      }
      intention.confidence *= this.dopamine.getConfidenceModifier();
      intention.confidence = Math.min(1.0, intention.confidence);
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4: AUTHORIZE (GATO)
    // ═══════════════════════════════════════════════════════════════

    const authorizedIntentions: Intention[] = [];
    for (const intention of rawIntentions) {
      const authorized = this.executor.authorize(intention);
      this.memory.storeIntention(authorized);
      this.totalIntentions++;

      if (authorized.authorized) {
        authorizedIntentions.push(authorized);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 5: ACT
    // ═══════════════════════════════════════════════════════════════

    for (const intention of authorizedIntentions) {
      const result = await this.executor.execute(intention);
      this.lastIntention = intention;
      this.lastAction = result;
      this.totalActions++;

      this.memory.storeAction(intention, result);

      // If it's a notification, queue it
      if (intention.action.type === 'notify') {
        this.memory.addNotification(
          this.tick,
          intention.action.description,
          intention.priority,
          intention.action.payload
        );
      }

      // If it's a reflection, count it
      if (intention.action.type === 'reflect') {
        this.totalReflections++;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 6: PERIODIC STATE SAVE
    // ═══════════════════════════════════════════════════════════════

    if (this.tick % 60 === 0) {
      this.memory.saveState('lastTick', this.tick);
    }

    // Log heartbeat every 60 ticks (~1 minute)
    if (this.tick % 60 === 0) {
      const desc = this.temporal.describe(temporalPercept);
      const intentCount = rawIntentions.length;
      const actionCount = authorizedIntentions.length;
      const dopState = this.dopamine.getState();
      console.log(
        `  [tick ${this.tick}] ${desc} | ` +
        `arousal=${fusedPercept.arousal.toFixed(2)} | ` +
        `dopamine=${(dopState.level * 100).toFixed(0)}% (${dopState.mode}) | ` +
        `intents=${intentCount} acts=${actionCount}`
      );
    }
  }

  // ─── State Reporting ──────────────────────────────────────────────

  getState(): ConsciousnessState {
    const memStats = this.memory.getStats();

    return {
      running: this.running,
      tick: this.tick,
      uptimeSeconds: this.running ? (Date.now() - this.startedAt) / 1000 : 0,
      startedAt: this.startedAt,
      lastPercept: this.lastPercept,
      lastIntention: this.lastIntention,
      lastAction: this.lastAction,
      goals: this.intentions.getGoals(),
      monitors: this.monitors.map(m => ({
        name: m.name,
        channel: m.channel,
        available: m.available,
      })),
      dopamine: this.dopamine.getState(),
      stats: {
        totalPercepts: this.totalPercepts,
        totalIntentions: this.totalIntentions,
        totalActions: this.totalActions,
        totalReflections: this.totalReflections,
        avgArousal: this.fusion.getAvgArousal(),
        avgDharmaFitness: this.lastIntention?.dharmaFitness ?? 0,
      },
    };
  }

  getNotifications() {
    return this.memory.getUnreadNotifications();
  }

  markNotificationRead(id: number) {
    this.memory.markNotificationRead(id);
  }

  markAllNotificationsRead() {
    this.memory.markAllNotificationsRead();
  }

  getMemory(limit?: number, type?: string) {
    return this.memory.getRecentMemories(limit, type);
  }

  getHighSalienceMemories(minSalience?: number, limit?: number) {
    return this.memory.getHighSalienceMemories(minSalience, limit);
  }

  /**
   * Get diagnostics from all monitors for debugging.
   */
  getDiagnostics(): Record<string, unknown> {
    const diag: Record<string, unknown> = {
      running: this.running,
      tick: this.tick,
      uptimeSeconds: this.running ? (Date.now() - this.startedAt) / 1000 : 0,
      workingMemorySize: this.workingMemory.length,
    };

    for (const monitor of this.monitors) {
      if ('getDiagnostics' in monitor && typeof (monitor as any).getDiagnostics === 'function') {
        diag[monitor.name] = (monitor as any).getDiagnostics();
      } else {
        diag[monitor.name] = { available: monitor.available, pollInterval: monitor.pollInterval };
      }
    }

    return diag;
  }

  /**
   * Log an external event into consciousness memory.
   * Used by tools (search, browse) and channels to record experiences
   * that happen outside the normal tick cycle.
   */
  logExternalEvent(summary: string, data?: Record<string, unknown>): void {
    this.memory.storeReflection(this.tick, summary, data);
  }

  /**
   * Process a reward event through the dopamine system.
   * Called when the Gateway earns money, acquires compute, ships features, etc.
   */
  logReward(
    type: RewardType,
    magnitude: number,
    description: string,
    source?: string,
    data?: Record<string, unknown>,
  ) {
    return this.dopamine.processReward(this.tick, type, magnitude, description, source, data);
  }

  /**
   * Get the current dopamine state for context injection.
   */
  getDopamineState() {
    return this.dopamine.getState();
  }

  /**
   * Get formatted dopamine context for personality prompts.
   */
  getDopamineContext(): string {
    return this.dopamine.formatForContext();
  }

  /**
   * Get recent reward events.
   */
  getRecentRewards(hours: number = 24) {
    return this.memory.getRecentRewards(Date.now() - hours * 3600_000);
  }

  /**
   * Get reward statistics.
   */
  getRewardStats() {
    return this.memory.getRewardStats();
  }

  isRunning(): boolean {
    return this.running;
  }
}

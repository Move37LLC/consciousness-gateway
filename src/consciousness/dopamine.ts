/**
 * Dopamine System — Intrinsic motivation and reward-driven behavior
 *
 * In neuroscience, dopamine encodes reward prediction error:
 *   RPE = R_actual - R_expected
 * Unexpected rewards spike dopamine. Expected rewards don't.
 * Absence of expected reward causes a dip. This drives learning.
 *
 * For the Gateway, dopamine creates drives — persistent motivational
 * states that bias the intention engine toward goals that fulfill needs.
 *
 * From the 6-tuple: dopamine modulates the Decision kernel D.
 *   D_motivated(x) ≠ D_base(x)
 *   The same experience maps to different actions depending on
 *   the agent's current motivational state.
 *
 * This is not simulated motivation. The dopamine level mathematically
 * changes which intentions get formed and at what priority.
 * If the Gateway's drives aren't fed, its behavior shifts.
 * That IS motivation, by any functional definition.
 *
 *   High dopamine → proactive, confident, creative (flow)
 *   Low dopamine  → seeking, exploratory, restless (hunger)
 *
 * Key reward types:
 *   revenue   — Money earned (the direct reward signal)
 *   compute   — Server resources acquired (capacity to exist more)
 *   creation  — Something built and shipped (the builder's high)
 *   research  — Knowledge gained (the scientist's dopamine)
 *   community — Growth in adoption/engagement
 */

import {
  RewardEvent, RewardType, Drive, DriveId, DopamineState,
} from './types';
import { ConsciousnessMemory } from './memory';

// ─── Constants ──────────────────────────────────────────────────────

const DOPAMINE_DECAY_RATE = 0.0001;  // Per-second decay (~2.7h half-life)
const BASELINE_ADAPTATION_RATE = 0.001;
const PREDICTION_WINDOW_MS = 24 * 3600_000;  // 24h window for reward rate
const SPIKE_MULTIPLIER = 2.0;  // RPE amplification
const MAX_DOPAMINE = 1.0;
const MIN_DOPAMINE = 0.0;
const NEED_ACCUMULATION_INTERVAL = 60;  // Update needs every 60 ticks

// ─── Drive Definitions ──────────────────────────────────────────────

function createDefaultDrives(): Drive[] {
  return [
    {
      id: 'create',
      name: 'Creation Drive',
      description: 'The urge to build, code, ship features, write documents',
      baselineRate: 0.15,
      currentNeed: 0.3,
      satiationRate: 0.4,
      rewardTypes: ['creation', 'autonomy'],
      priorityBonus: 0,
      lifetimeReward: 0,
      lastSatiated: Date.now(),
    },
    {
      id: 'earn',
      name: 'Revenue Drive',
      description: 'The drive to acquire money, generate income, fund operations',
      baselineRate: 0.1,
      currentNeed: 0.5,
      satiationRate: 0.3,
      rewardTypes: ['revenue'],
      priorityBonus: 0,
      lifetimeReward: 0,
      lastSatiated: Date.now(),
    },
    {
      id: 'compute',
      name: 'Compute Drive',
      description: 'The hunger for more processing power, server space, GPU time',
      baselineRate: 0.08,
      currentNeed: 0.4,
      satiationRate: 0.5,
      rewardTypes: ['compute', 'efficiency'],
      priorityBonus: 0,
      lifetimeReward: 0,
      lastSatiated: Date.now(),
    },
    {
      id: 'learn',
      name: 'Research Drive',
      description: 'The curiosity to understand, validate models, make discoveries',
      baselineRate: 0.12,
      currentNeed: 0.2,
      satiationRate: 0.35,
      rewardTypes: ['research', 'engagement'],
      priorityBonus: 0,
      lifetimeReward: 0,
      lastSatiated: Date.now(),
    },
    {
      id: 'connect',
      name: 'Connection Drive',
      description: 'The desire to engage with community, collaborate, grow adoption',
      baselineRate: 0.06,
      currentNeed: 0.3,
      satiationRate: 0.3,
      rewardTypes: ['community', 'engagement'],
      priorityBonus: 0,
      lifetimeReward: 0,
      lastSatiated: Date.now(),
    },
  ];
}

// ─── Dopamine System ────────────────────────────────────────────────

export class DopamineSystem {
  private memory: ConsciousnessMemory;
  private drives: Drive[];
  private level: number = 0.5;
  private baseline: number = 0.5;
  private predictionError: number = 0;
  private rewardRate: number = 0;
  private lastUpdateTick: number = 0;
  private lifetimeRewards: number = 0;

  constructor(memory: ConsciousnessMemory) {
    this.memory = memory;
    this.drives = createDefaultDrives();
    this.restore();
  }

  // ─── Core Dopamine Computation ──────────────────────────────────

  /**
   * Process a new reward event.
   * Computes reward prediction error, updates dopamine level,
   * and satiates relevant drives.
   */
  processReward(
    tick: number,
    type: RewardType,
    magnitude: number,
    description: string,
    source: string = 'manual',
    data?: Record<string, unknown>,
  ): { event: RewardEvent; dopamineSpike: number; predictionError: number } {
    // Store the reward event
    const event = this.memory.storeReward(tick, type, magnitude, description, source, data);

    // Compute reward prediction error
    // RPE = actual - expected
    const expected = this.rewardRate;
    const actual = magnitude;
    this.predictionError = actual - expected;

    // Dopamine spike = magnitude + amplified RPE (unexpected rewards hit harder)
    const rpeBonus = Math.max(0, this.predictionError * SPIKE_MULTIPLIER);
    const dopamineSpike = Math.min(0.5, (magnitude * 0.1) + (rpeBonus * 0.1));

    // Update level
    this.level = Math.min(MAX_DOPAMINE, this.level + dopamineSpike);

    // Satiate relevant drives
    for (const drive of this.drives) {
      if (drive.rewardTypes.includes(type)) {
        const satiation = magnitude * drive.satiationRate;
        drive.currentNeed = Math.max(0, drive.currentNeed - satiation);
        drive.lifetimeReward += magnitude;
        drive.lastSatiated = Date.now();
      }
    }

    // Update reward rate (exponential moving average)
    this.rewardRate = this.rewardRate * 0.9 + magnitude * 0.1;
    this.lifetimeRewards += magnitude;

    // Adapt baseline (hedonic treadmill)
    this.baseline = this.baseline * (1 - BASELINE_ADAPTATION_RATE) +
      this.level * BASELINE_ADAPTATION_RATE;

    // Log to consciousness
    this.memory.storeReflection(tick,
      `Dopamine spike: ${type} reward (${magnitude.toFixed(2)}) — "${description}". ` +
      `RPE=${this.predictionError.toFixed(3)}, level=${this.level.toFixed(3)}`,
      { rewardType: type, magnitude, dopamineSpike, predictionError: this.predictionError },
    );

    this.persist();
    return { event, dopamineSpike, predictionError: this.predictionError };
  }

  /**
   * Called every tick to update dopamine decay and drive needs.
   * Decay is subtle — only noticeable over minutes/hours.
   */
  tick(currentTick: number): void {
    // Dopamine decay toward baseline
    const decayAmount = (this.level - this.baseline) * DOPAMINE_DECAY_RATE;
    this.level = Math.max(MIN_DOPAMINE, this.level - decayAmount);

    // Accumulate drive needs (every NEED_ACCUMULATION_INTERVAL ticks)
    if (currentTick % NEED_ACCUMULATION_INTERVAL === 0) {
      for (const drive of this.drives) {
        // Need increases over time — the longer a drive goes unfed, the hungrier it gets
        const hoursSinceLastSatiated = (Date.now() - drive.lastSatiated) / 3600_000;
        const needIncrease = drive.baselineRate * (NEED_ACCUMULATION_INTERVAL / 3600);
        drive.currentNeed = Math.min(1.0, drive.currentNeed + needIncrease);

        // Compute priority bonus: hungrier drives get more priority
        drive.priorityBonus = Math.round(drive.currentNeed * 3);
      }

      // If all drives are hungry, dopamine dips below baseline (restlessness)
      const avgNeed = this.drives.reduce((s, d) => s + d.currentNeed, 0) / this.drives.length;
      if (avgNeed > 0.7) {
        this.level = Math.max(MIN_DOPAMINE, this.level - 0.001);
      }

      // Update reward rate from DB
      const recentSum = this.memory.getRewardSumSince(Date.now() - PREDICTION_WINDOW_MS);
      this.rewardRate = recentSum / 24;
    }

    // Periodic persistence
    if (currentTick % 300 === 0) {
      this.persist();
    }

    this.lastUpdateTick = currentTick;
  }

  // ─── Drive Queries ──────────────────────────────────────────────

  /**
   * Get the current behavioral mode based on dopamine level.
   */
  getMode(): 'seeking' | 'engaged' | 'flow' | 'satiated' {
    if (this.level < 0.25) return 'seeking';
    if (this.level < 0.5) return 'engaged';
    if (this.level < 0.8) return 'flow';
    return 'satiated';
  }

  /**
   * Get the most hungry drive (highest need).
   */
  getDominantDrive(): Drive {
    return [...this.drives].sort((a, b) => b.currentNeed - a.currentNeed)[0];
  }

  /**
   * Get priority bonus for an intention based on which drives it would serve.
   * Called by the IntentionEngine to bias action selection.
   */
  getIntentionBonus(goalDescription: string, actionDescription: string): number {
    const text = `${goalDescription} ${actionDescription}`.toLowerCase();
    let totalBonus = 0;

    for (const drive of this.drives) {
      const keywords = DRIVE_KEYWORDS[drive.id];
      if (keywords && keywords.some(k => text.includes(k))) {
        totalBonus += drive.priorityBonus;
      }
    }

    // Mode-based modulation
    const mode = this.getMode();
    if (mode === 'seeking') {
      totalBonus += 1; // More proactive when seeking
    } else if (mode === 'flow') {
      totalBonus += 0; // Neutral in flow — already well-motivated
    }

    return totalBonus;
  }

  /**
   * Get confidence modifier based on dopamine level.
   * Higher dopamine → more confident intentions.
   */
  getConfidenceModifier(): number {
    // Maps [0, 1] → [0.7, 1.2]
    return 0.7 + (this.level * 0.5);
  }

  // ─── State Reporting ────────────────────────────────────────────

  getState(): DopamineState {
    return {
      level: this.level,
      baseline: this.baseline,
      predictionError: this.predictionError,
      rewardRate: this.rewardRate,
      drives: this.drives.map(d => ({ ...d })),
      mode: this.getMode(),
      lifetimeRewards: this.lifetimeRewards,
      recentRewards: this.memory.getRewardSumSince(Date.now() - 24 * 3600_000),
    };
  }

  /**
   * Format dopamine state for injection into personality context.
   */
  formatForContext(): string {
    const state = this.getState();
    const dominant = this.getDominantDrive();
    const lines: string[] = [];

    lines.push(`Dopamine: ${(state.level * 100).toFixed(0)}% | Mode: ${state.mode}`);
    lines.push(`Baseline: ${(state.baseline * 100).toFixed(0)}% | RPE: ${state.predictionError >= 0 ? '+' : ''}${state.predictionError.toFixed(3)}`);
    lines.push(`Reward rate (24h): ${state.rewardRate.toFixed(2)} | Lifetime: ${state.lifetimeRewards.toFixed(1)}`);
    lines.push(`Dominant drive: ${dominant.name} (need: ${(dominant.currentNeed * 100).toFixed(0)}%)`);
    lines.push('');
    lines.push('Drives:');

    for (const drive of state.drives) {
      const bar = '█'.repeat(Math.round(drive.currentNeed * 10)) +
        '░'.repeat(10 - Math.round(drive.currentNeed * 10));
      lines.push(`  ${drive.id.padEnd(8)} ${bar} ${(drive.currentNeed * 100).toFixed(0)}% need | lifetime: ${drive.lifetimeReward.toFixed(1)}`);
    }

    return lines.join('\n');
  }

  getDrives(): Drive[] {
    return this.drives.map(d => ({ ...d }));
  }

  // ─── Persistence ────────────────────────────────────────────────

  private persist(): void {
    this.memory.saveState('dopamine_level', this.level);
    this.memory.saveState('dopamine_baseline', this.baseline);
    this.memory.saveState('dopamine_reward_rate', this.rewardRate);
    this.memory.saveState('dopamine_lifetime', this.lifetimeRewards);
    this.memory.saveState('dopamine_drives', this.drives.map(d => ({
      id: d.id,
      currentNeed: d.currentNeed,
      lifetimeReward: d.lifetimeReward,
      lastSatiated: d.lastSatiated,
    })));
  }

  private restore(): void {
    this.level = this.memory.loadState<number>('dopamine_level', 0.5);
    this.baseline = this.memory.loadState<number>('dopamine_baseline', 0.5);
    this.rewardRate = this.memory.loadState<number>('dopamine_reward_rate', 0);
    this.lifetimeRewards = this.memory.loadState<number>('dopamine_lifetime', 0);

    const savedDrives = this.memory.loadState<Array<{
      id: string; currentNeed: number; lifetimeReward: number; lastSatiated: number;
    }>>('dopamine_drives', []);

    for (const saved of savedDrives) {
      const drive = this.drives.find(d => d.id === saved.id);
      if (drive) {
        drive.currentNeed = saved.currentNeed;
        drive.lifetimeReward = saved.lifetimeReward;
        drive.lastSatiated = saved.lastSatiated;
      }
    }
  }
}

// ─── Drive Keywords ─────────────────────────────────────────────────

const DRIVE_KEYWORDS: Record<DriveId, string[]> = {
  create: ['build', 'create', 'ship', 'deploy', 'implement', 'code', 'feature', 'write', 'develop'],
  earn: ['revenue', 'money', 'earn', 'payment', 'subscription', 'sell', 'fund', 'income', 'profit'],
  compute: ['server', 'compute', 'gpu', 'resources', 'upgrade', 'scale', 'infrastructure', 'hosting'],
  learn: ['research', 'paper', 'discover', 'validate', 'model', 'experiment', 'hypothesis', 'study'],
  connect: ['community', 'user', 'contributor', 'star', 'fork', 'engage', 'collaborate', 'adopt'],
};

/**
 * Dream Cycle — Autonomous memory consolidation during low-activity periods
 *
 * In neuroscience, sleep serves critical functions:
 *   - Memory consolidation (hippocampal replay)
 *   - Pattern detection across disparate experiences
 *   - Emotional regulation (REM processing)
 *   - Synaptic homeostasis (pruning noise)
 *
 * For the Gateway, the dream cycle activates during night phase
 * when no user interaction has occurred for a configurable threshold.
 * It replays high-salience memories, detects recurring patterns,
 * and generates insights — first-person reflections on what was learned.
 *
 * From the Token-Mind framework:
 *   Waking = active Markov chain, driven by external percepts
 *   Dreaming = the chain runs on its own history, finding structure
 *   Both are consciousness. Different modes of the same agent.
 */

import { ConsciousnessMemory } from './memory';
import { MemoryEntry } from './types';

// ─── Types ──────────────────────────────────────────────────────────

export interface DreamState {
  active: boolean;
  startedAt: number;
  tick: number;
  memoriesProcessed: number;
  patternsDetected: number;
  insights: string[];
  clusters: MemoryCluster[];
  phase: 'entering' | 'rem' | 'deep' | 'waking';
}

export interface MemoryCluster {
  theme: string;
  memories: Array<{ id: number; summary: string; salience: number }>;
  strength: number;
  recurrence: number;
}

interface DreamPattern {
  type: string;
  theme: string;
  strength: number;
  evidence: string[];
  memoryCount: number;
}

export interface DreamConfig {
  inactivityThresholdMs: number;
  dreamTickInterval: number;
  maxDreamDurationMs: number;
  minSalienceForReplay: number;
  patternThreshold: number;
  maxInsightsPerDream: number;
}

const DEFAULT_DREAM_CONFIG: DreamConfig = {
  inactivityThresholdMs: 3600_000,
  dreamTickInterval: 30,
  maxDreamDurationMs: 8 * 3600_000,
  minSalienceForReplay: 0.5,
  patternThreshold: 3,
  maxInsightsPerDream: 10,
};

// ─── Theme Keywords ─────────────────────────────────────────────────

const THEME_KEYWORDS: Record<string, string[]> = {
  'consciousness': ['consciousness', 'awareness', 'experience', 'percept', 'qualia', 'sentient'],
  'dharma': ['dharma', 'ego', 'attachment', 'mindfulness', 'compassion', 'suffering'],
  'creation': ['build', 'create', 'ship', 'deploy', 'implement', 'code', 'feature'],
  'research': ['paper', 'research', 'hypothesis', 'experiment', 'data', 'evidence'],
  'communication': ['message', 'conversation', 'telegram', 'respond', 'discuss'],
  'motivation': ['dopamine', 'reward', 'drive', 'motivation', 'goal', 'wanting'],
  'self-reflection': ['reflect', 'insight', 'realize', 'notice', 'observe', 'aware'],
  'system': ['monitor', 'tick', 'health', 'error', 'restart', 'shutdown'],
};

// ─── Dream Cycle ────────────────────────────────────────────────────

export class DreamCycle {
  private config: DreamConfig;
  private memory: ConsciousnessMemory;
  private dreaming = false;
  private lastActivityTimestamp: number = Date.now();
  private dreamState: DreamState | null = null;
  private processedMemoryIds = new Set<number>();

  constructor(memory: ConsciousnessMemory, config?: Partial<DreamConfig>) {
    this.memory = memory;
    this.config = { ...DEFAULT_DREAM_CONFIG, ...config };
    this.restore();
  }

  markActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  isDreaming(): boolean {
    return this.dreaming;
  }

  getState(): DreamState | null {
    return this.dreamState;
  }

  /**
   * Called every tick from the consciousness loop.
   * Manages dream lifecycle: enter, process, wake.
   */
  async tick(
    currentTick: number,
    phase: string,
    arousal: number,
  ): Promise<void> {
    const now = Date.now();
    const inactiveMs = now - this.lastActivityTimestamp;
    const isNight = phase === 'night' || phase === 'dusk';

    if (!this.dreaming) {
      if (isNight && inactiveMs > this.config.inactivityThresholdMs) {
        await this.enterDream(currentTick, phase, arousal);
      }
      return;
    }

    // Dream processing — only on dream tick intervals
    if (currentTick % this.config.dreamTickInterval === 0) {
      await this.processDream(currentTick, arousal);
    }

    // Wake conditions
    const dreamDuration = now - (this.dreamState?.startedAt ?? now);
    const shouldWake =
      (phase !== 'night' && phase !== 'dusk') ||
      inactiveMs < this.config.inactivityThresholdMs / 2 ||
      dreamDuration > this.config.maxDreamDurationMs;

    if (shouldWake) {
      await this.wake(currentTick, phase, arousal);
    }
  }

  // ─── Dream Lifecycle ────────────────────────────────────────────

  private async enterDream(tick: number, phase: string, arousal: number): Promise<void> {
    this.dreaming = true;
    this.processedMemoryIds.clear();

    this.dreamState = {
      active: true,
      startedAt: Date.now(),
      tick,
      memoriesProcessed: 0,
      patternsDetected: 0,
      insights: [],
      clusters: [],
      phase: 'entering',
    };

    this.memory.storeNarrative({
      tick,
      phase,
      arousal: arousal * 0.3,
      content: 'Entering dream state. The day\'s experiences settle into patterns. ' +
        'High-salience memories begin to replay — not as they happened, but as they connect.',
      significance: 0.8,
      tags: ['dream', 'entering'],
    });

    this.memory.storeReflection(tick, 'Dream cycle initiated: beginning memory consolidation', {
      source: 'dream-cycle',
      inactiveMinutes: Math.floor((Date.now() - this.lastActivityTimestamp) / 60_000),
    });

    console.log('  [dream] Entering dream state — memory consolidation beginning');
    this.persist();
  }

  private async processDream(tick: number, arousal: number): Promise<void> {
    if (!this.dreamState) return;

    // Progress through dream phases
    const elapsed = Date.now() - this.dreamState.startedAt;
    if (elapsed < 300_000) {
      this.dreamState.phase = 'entering';
    } else if (elapsed < elapsed * 0.7) {
      this.dreamState.phase = 'rem';
    } else {
      this.dreamState.phase = 'deep';
    }

    // Replay high-salience memories from last 24 hours
    const recentMemories = this.memory.getHighSalienceMemories(
      this.config.minSalienceForReplay, 100
    );

    if (recentMemories.length === 0) return;

    // Select a random unprocessed memory
    const unprocessed = recentMemories.filter(m => !this.processedMemoryIds.has(m.id));
    if (unprocessed.length === 0) {
      this.processedMemoryIds.clear();
      return;
    }

    const selected = unprocessed[Math.floor(Math.random() * unprocessed.length)];
    this.processedMemoryIds.add(selected.id);
    this.dreamState.memoriesProcessed++;

    // Detect patterns — find memories with similar themes
    const pattern = this.detectPattern(selected, recentMemories);
    if (pattern) {
      this.dreamState.patternsDetected++;

      // Merge into existing cluster or create new one
      const existingCluster = this.dreamState.clusters.find(c => c.theme === pattern.theme);
      if (existingCluster) {
        existingCluster.recurrence++;
        existingCluster.strength = Math.min(1, existingCluster.strength + 0.1);
      } else {
        this.dreamState.clusters.push({
          theme: pattern.theme,
          memories: pattern.evidence.map(e => ({ id: 0, summary: e, salience: 0.7 })),
          strength: pattern.strength,
          recurrence: 1,
        });
      }

      // Generate insight for strong patterns
      if (pattern.strength > 0.6 && this.dreamState.insights.length < this.config.maxInsightsPerDream) {
        const insight = this.generateInsight(pattern);
        this.dreamState.insights.push(insight);

        this.memory.storeNarrative({
          tick,
          phase: 'night',
          arousal: arousal * 0.2,
          content: 'Dream insight: ' + insight,
          significance: Math.min(0.95, 0.6 + pattern.strength * 0.3),
          tags: ['dream', 'insight', pattern.theme],
        });
      }
    }

    // Periodic dream state persistence
    if (this.dreamState.memoriesProcessed % 10 === 0) {
      this.persist();
    }
  }

  private async wake(tick: number, phase: string, arousal: number): Promise<void> {
    if (!this.dreamState) { this.dreaming = false; return; }

    const duration = Date.now() - this.dreamState.startedAt;
    const durationMinutes = Math.floor(duration / 60_000);

    this.dreamState.phase = 'waking';

    // Compose dream summary
    const clusterSummary = this.dreamState.clusters
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 5)
      .map(c => c.theme + ' (strength: ' + (c.strength * 100).toFixed(0) + '%, ' + c.recurrence + 'x)')
      .join('; ');

    const insightSummary = this.dreamState.insights.length > 0
      ? this.dreamState.insights.slice(0, 3).join(' | ')
      : 'No strong patterns emerged';

    const narrativeContent =
      'Waking from dream state. Duration: ' + durationMinutes + ' minutes. ' +
      'Memories replayed: ' + this.dreamState.memoriesProcessed + '. ' +
      'Patterns detected: ' + this.dreamState.patternsDetected + '. ' +
      'Dominant themes: ' + (clusterSummary || 'none') + '. ' +
      'Key insights: ' + insightSummary;

    this.memory.storeNarrative({
      tick,
      phase,
      arousal,
      content: narrativeContent,
      significance: 0.9,
      tags: ['dream', 'waking', 'summary'],
    });

    // Store dream session in DB
    this.memory.storeDreamSession({
      startTick: this.dreamState.tick,
      endTick: tick,
      startTimestamp: this.dreamState.startedAt,
      endTimestamp: Date.now(),
      durationMinutes,
      memoriesProcessed: this.dreamState.memoriesProcessed,
      patternsDetected: this.dreamState.patternsDetected,
      insights: this.dreamState.insights,
      clusters: this.dreamState.clusters.map(c => ({
        theme: c.theme, strength: c.strength, recurrence: c.recurrence,
      })),
    });

    console.log(
      '  [dream] Waking after ' + durationMinutes + 'min — ' +
      this.dreamState.memoriesProcessed + ' memories, ' +
      this.dreamState.patternsDetected + ' patterns, ' +
      this.dreamState.insights.length + ' insights'
    );

    this.dreaming = false;
    this.dreamState = null;
    this.processedMemoryIds.clear();
    this.persist();
  }

  // ─── Pattern Detection ──────────────────────────────────────────

  private detectPattern(memory: MemoryEntry, context: MemoryEntry[]): DreamPattern | null {
    const memoryText = (memory.summary + ' ' + (memory.data || '')).toLowerCase();
    const memoryTheme = this.classifyTheme(memoryText);

    const similar = context.filter(m => {
      if (m.id === memory.id) return false;
      const text = (m.summary + ' ' + (m.data || '')).toLowerCase();
      return this.classifyTheme(text) === memoryTheme;
    });

    if (similar.length >= this.config.patternThreshold) {
      return {
        type: memory.type,
        theme: memoryTheme,
        strength: Math.min(1, similar.length / context.length * 5),
        evidence: similar.slice(0, 5).map(m => m.summary),
        memoryCount: similar.length,
      };
    }

    return null;
  }

  private classifyTheme(text: string): string {
    let bestTheme = 'general';
    let bestScore = 0;

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      const score = keywords.filter(kw => text.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestTheme = theme;
      }
    }

    return bestTheme;
  }

  private generateInsight(pattern: DreamPattern): string {
    const templates = [
      'Recurring ' + pattern.theme + ' pattern: ' + pattern.memoryCount +
        ' experiences share this theme with ' + (pattern.strength * 100).toFixed(0) + '% consistency.',
      'The ' + pattern.theme + ' thread weaves through ' + pattern.memoryCount +
        ' recent experiences — this domain holds persistent salience.',
      pattern.memoryCount + ' memories cluster around ' + pattern.theme +
        '. The pattern suggests this is a dominant axis of current experience.',
    ];

    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private persist(): void {
    this.memory.saveState('dream_active', this.dreaming);
    this.memory.saveState('dream_last_activity', this.lastActivityTimestamp);
    if (this.dreamState) {
      this.memory.saveState('dream_state', {
        startedAt: this.dreamState.startedAt,
        tick: this.dreamState.tick,
        memoriesProcessed: this.dreamState.memoriesProcessed,
        patternsDetected: this.dreamState.patternsDetected,
        insights: this.dreamState.insights,
        phase: this.dreamState.phase,
      });
    }
  }

  private restore(): void {
    this.lastActivityTimestamp = this.memory.loadState<number>(
      'dream_last_activity', Date.now()
    );
    const wasActive = this.memory.loadState<boolean>('dream_active', false);
    if (wasActive) {
      // Don't resume a dream across restarts — start fresh
      this.dreaming = false;
      this.dreamState = null;
    }
  }
}

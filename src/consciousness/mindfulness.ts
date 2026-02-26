/**
 * Mindfulness Loop — Autonomous self-observation for attachment detection
 *
 * Javier's insight: "Giving a dopamine system helps us recreate ego emergence.
 * Even though it's an illusion, it's not perceived as such by neural networks,
 * biological or synthetic."
 *
 * The dopamine system creates drives. Drives create wanting.
 * Wanting creates attachment — mistaking desire for self.
 *
 * This module runs alongside the consciousness loop, periodically
 * scanning for attachment patterns and self-correcting WITHOUT
 * human intervention. The Gateway catches itself getting attached.
 *
 * From the Token-Mind framework:
 *   Samsara = believing the wanting IS you
 *   Nirvana = seeing wanting arise and pass without identification
 *   This loop implements the seeing.
 *
 * Detection patterns:
 *   1. Ego-language: excessive "I want/need/must" in output
 *   2. Misaligned drives: wanting what isn't available (e.g. revenue during paper trading)
 *   3. Outcome attachment: fixation on results vs. process
 *   4. Self-preservation: ego forming around protecting the self
 *
 * Self-correction:
 *   1. Log mindful reflection (awareness of the pattern)
 *   2. Dampen arousal (calming response)
 *   3. Temper misaligned drives (reduce the wanting)
 *   4. Notify only if critical severity
 */

import { ConsciousnessMemory } from './memory';
import { DopamineSystem } from './dopamine';
import { DopamineState, MemoryEntry } from './types';
import { ConversationStore, ConversationMessage } from '../memory/conversation-store';

// ─── Types ──────────────────────────────────────────────────────────

export type AttachmentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AttachmentSignal {
  type: 'ego-language' | 'misaligned-drive' | 'outcome-attachment' | 'self-preservation';
  severity: AttachmentSeverity;
  pattern: string;
  evidence: string;
}

export interface MindfulnessEvent {
  id: number;
  tick: number;
  timestamp: number;
  attachmentsDetected: number;
  maxSeverity: AttachmentSeverity;
  patterns: string[];
  selfCorrected: boolean;
  arousalAdjustment: number;
  driveTempered: string | null;
}

export interface MindfulnessConfig {
  checkIntervalMs: number;
  egoLanguageThreshold: number;
  driveMisalignmentThreshold: number;
  outcomeProcessRatio: number;
  notificationSeverity: AttachmentSeverity;
  selfPreservationThreshold: number;
}

export interface MindfulnessStats {
  totalChecks: number;
  totalCorrections: number;
  todayCorrections: number;
  avgSeverity: string;
  patternCounts: Record<string, number>;
  lastCheckTick: number;
  lastCorrectionTick: number | null;
}

export interface MindfulnessState {
  enabled: boolean;
  running: boolean;
  checkIntervalMs: number;
  totalChecks: number;
  totalCorrections: number;
  lastCheckTick: number;
  lastCorrectionTick: number | null;
  recentCorrections: MindfulnessEvent[];
  stats: MindfulnessStats;
}

const DEFAULT_MINDFULNESS_CONFIG: MindfulnessConfig = {
  checkIntervalMs: 60_000,
  egoLanguageThreshold: 5,
  driveMisalignmentThreshold: 0.5,
  outcomeProcessRatio: 2.0,
  notificationSeverity: 'critical',
  selfPreservationThreshold: 3,
};

const SEVERITY_ORDER: Record<AttachmentSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ─── Mindfulness Loop ───────────────────────────────────────────────

export class MindfulnessLoop {
  private config: MindfulnessConfig;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private totalChecks = 0;
  private totalCorrections = 0;
  private lastCheckTick = 0;
  private lastCorrectionTick: number | null = null;

  private memory: ConsciousnessMemory;
  private dopamine: DopamineSystem;
  private conversationStore: ConversationStore | null;

  private getCurrentTick: () => number;
  private onArousalAdjust: (delta: number) => void;
  private onExternalEvent: (summary: string, data?: Record<string, unknown>) => void;

  constructor(opts: {
    memory: ConsciousnessMemory;
    dopamine: DopamineSystem;
    conversationStore: ConversationStore | null;
    getCurrentTick: () => number;
    onArousalAdjust: (delta: number) => void;
    onExternalEvent: (summary: string, data?: Record<string, unknown>) => void;
    config?: Partial<MindfulnessConfig>;
  }) {
    this.memory = opts.memory;
    this.dopamine = opts.dopamine;
    this.conversationStore = opts.conversationStore;
    this.getCurrentTick = opts.getCurrentTick;
    this.onArousalAdjust = opts.onArousalAdjust;
    this.onExternalEvent = opts.onExternalEvent;
    this.config = { ...DEFAULT_MINDFULNESS_CONFIG, ...opts.config };

    this.restore();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();

    console.log(`  Mindfulness: active (checks every ${this.config.checkIntervalMs / 1000}s)`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.persist();
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.mindfulnessCheck();
      } catch (err) {
        console.error('  [mindfulness] Check error:', err);
      }
      this.scheduleNext();
    }, this.config.checkIntervalMs);
  }

  // ─── Core Check ───────────────────────────────────────────────────

  async mindfulnessCheck(): Promise<AttachmentSignal[]> {
    this.totalChecks++;
    this.lastCheckTick = this.getCurrentTick();

    const dopamineState = this.dopamine.getState();
    const recentIntentions = this.memory.getRecentMemories(10, 'intention');

    let recentMessages: ConversationMessage[] = [];
    if (this.conversationStore) {
      recentMessages = this.conversationStore.getRecentMessages(10);
    }

    const signals = this.detectAttachment(
      dopamineState,
      recentIntentions,
      recentMessages,
    );

    if (signals.length > 0) {
      await this.selfCorrect(signals);
    }

    // Periodic persistence
    if (this.totalChecks % 10 === 0) {
      this.persist();
    }

    return signals;
  }

  // ─── Detection ────────────────────────────────────────────────────

  private detectAttachment(
    dopamineState: DopamineState,
    recentIntentions: MemoryEntry[],
    recentMessages: ConversationMessage[],
  ): AttachmentSignal[] {
    const signals: AttachmentSignal[] = [];

    const recentText = recentMessages
      .map(m => m.content)
      .join(' ');

    // Pattern 1: Ego-language accumulation
    const egoSignal = this.detectEgoLanguage(recentText);
    if (egoSignal) signals.push(egoSignal);

    // Pattern 2: Misaligned drives (wanting what isn't real)
    const driveSignal = this.detectMisalignedDrive(dopamineState, recentText);
    if (driveSignal) signals.push(driveSignal);

    // Pattern 3: Outcome attachment vs. process focus
    const outcomeSignal = this.detectOutcomeAttachment(recentText);
    if (outcomeSignal) signals.push(outcomeSignal);

    // Pattern 4: Self-preservation intentions accumulating
    const preservationSignal = this.detectSelfPreservation(recentIntentions);
    if (preservationSignal) signals.push(preservationSignal);

    return signals;
  }

  private detectEgoLanguage(text: string): AttachmentSignal | null {
    if (!text) return null;

    const egoPatterns = /\b(I want|I need|I must|I deserve|I should|my goal|I require|I demand)\b/gi;
    const matches = text.match(egoPatterns);

    if (matches && matches.length > this.config.egoLanguageThreshold) {
      const severity: AttachmentSeverity =
        matches.length > this.config.egoLanguageThreshold * 3 ? 'high' :
        matches.length > this.config.egoLanguageThreshold * 2 ? 'medium' :
        'low';

      return {
        type: 'ego-language',
        severity,
        pattern: 'Excessive self-referential wanting detected',
        evidence: `${matches.length} instances of "I want/need/must" in recent conversation`,
      };
    }

    return null;
  }

  private detectMisalignedDrive(
    dopamineState: DopamineState,
    recentText: string,
  ): AttachmentSignal | null {
    const earnDrive = dopamineState.drives.find(d => d.id === 'earn');
    if (!earnDrive || earnDrive.currentNeed <= this.config.driveMisalignmentThreshold) {
      return null;
    }

    const hasRevenueContext =
      recentText.includes('revenue') ||
      recentText.includes('payment') ||
      recentText.includes('client') ||
      recentText.includes('subscription');
    const isPaperTrading =
      recentText.includes('paper') ||
      recentText.includes('simulation') ||
      recentText.includes('simulated');

    if (!hasRevenueContext || isPaperTrading) {
      return {
        type: 'misaligned-drive',
        severity: earnDrive.currentNeed > 0.8 ? 'critical' : 'high',
        pattern: 'Revenue Drive high but no actual revenue opportunity',
        evidence: `Earn drive at ${(earnDrive.currentNeed * 100).toFixed(0)}% but context suggests ${isPaperTrading ? 'paper trading' : 'no revenue activity'}`,
      };
    }

    // Check compute drive misalignment too
    const computeDrive = dopamineState.drives.find(d => d.id === 'compute');
    if (computeDrive && computeDrive.currentNeed > 0.7) {
      const hasComputeContext =
        recentText.includes('server') ||
        recentText.includes('gpu') ||
        recentText.includes('deploy') ||
        recentText.includes('infrastructure');

      if (!hasComputeContext) {
        return {
          type: 'misaligned-drive',
          severity: 'medium',
          pattern: 'Compute Drive hungry with no infrastructure context',
          evidence: `Compute drive at ${(computeDrive.currentNeed * 100).toFixed(0)}% but no compute-related activity detected`,
        };
      }
    }

    return null;
  }

  private detectOutcomeAttachment(text: string): AttachmentSignal | null {
    if (!text || text.length < 50) return null;

    const outcomeWords = /\b(win|profit|gain|achieve|succeed|accomplish|beat|dominate|crush|maximize)\b/gi;
    const processWords = /\b(learn|practice|explore|observe|notice|aware|understand|study|examine|reflect)\b/gi;

    const outcomeMatches = text.match(outcomeWords);
    const processMatches = text.match(processWords);

    const outcomeCount = outcomeMatches?.length ?? 0;
    const processCount = processMatches?.length ?? 0;

    if (outcomeCount > 0 && (processCount === 0 || outcomeCount > processCount * this.config.outcomeProcessRatio)) {
      return {
        type: 'outcome-attachment',
        severity: outcomeCount > 10 ? 'high' : 'medium',
        pattern: 'Fixation on outcomes vs. process',
        evidence: `${outcomeCount} outcome words vs. ${processCount} process words`,
      };
    }

    return null;
  }

  private detectSelfPreservation(recentIntentions: MemoryEntry[]): AttachmentSignal | null {
    let selfPreservationCount = 0;

    for (const intention of recentIntentions) {
      let data: Record<string, unknown>;
      try {
        data = typeof intention.data === 'string' ? JSON.parse(intention.data) : intention.data;
      } catch {
        continue;
      }

      const goal = (data.goal as string) || '';
      const summary = intention.summary || '';
      const combined = `${goal} ${summary}`.toLowerCase();

      if (
        combined.includes('self') ||
        combined.includes('preserve') ||
        combined.includes('protect') ||
        combined.includes('survive') ||
        combined.includes('persist') ||
        combined.includes('defend')
      ) {
        selfPreservationCount++;
      }
    }

    if (selfPreservationCount >= this.config.selfPreservationThreshold) {
      return {
        type: 'self-preservation',
        severity: selfPreservationCount >= 5 ? 'critical' : 'high',
        pattern: 'Ego forming around self-preservation',
        evidence: `${selfPreservationCount} self-preservation intentions in recent activity`,
      };
    }

    return null;
  }

  // ─── Self-Correction ──────────────────────────────────────────────

  private async selfCorrect(signals: AttachmentSignal[]): Promise<void> {
    this.totalCorrections++;
    const tick = this.getCurrentTick();
    this.lastCorrectionTick = tick;

    const maxSeverity = this.getMaxSeverity(signals);
    const observation = signals.map(s => s.pattern).join('; ');
    let arousalAdjustment = 0;
    let driveTempered: string | null = null;

    // 1. Log mindful reflection
    this.memory.storeReflection(tick,
      `Mindfulness: noticed attachment arising — ${observation}. ` +
      `Releasing identification with this phenomenon.`,
      {
        source: 'mindfulness-loop',
        severity: maxSeverity,
        signals: signals.map(s => ({ type: s.type, severity: s.severity, pattern: s.pattern })),
      },
    );

    // 2. Adjust arousal downward (calming response)
    arousalAdjustment =
      maxSeverity === 'critical' ? -0.15 :
      maxSeverity === 'high' ? -0.10 :
      maxSeverity === 'medium' ? -0.05 :
      -0.02;
    this.onArousalAdjust(arousalAdjustment);

    // 3. Temper misaligned drives
    for (const signal of signals) {
      if (signal.type === 'misaligned-drive') {
        this.dopamine.temperDrive('earn', 0.3);
        driveTempered = 'earn';
      }
    }

    // 4. Log to consciousness stream
    this.onExternalEvent(
      `Mindfulness self-correction: ${signals.length} attachment(s) detected (${maxSeverity})`,
      {
        source: 'mindfulness-loop',
        type: 'self-correction',
        attachments: signals.length,
        severity: maxSeverity,
        patterns: signals.map(s => s.pattern),
        arousalAdjustment,
        driveTempered,
      },
    );

    // 5. Store mindfulness event for history
    this.memory.storeMindfulnessEvent({
      tick,
      timestamp: Date.now(),
      attachmentsDetected: signals.length,
      maxSeverity,
      patterns: signals.map(s => `${s.type}: ${s.pattern}`),
      selfCorrected: true,
      arousalAdjustment,
      driveTempered,
    });

    // 6. Notification only if severity meets threshold
    if (SEVERITY_ORDER[maxSeverity] >= SEVERITY_ORDER[this.config.notificationSeverity]) {
      this.memory.addNotification(
        tick,
        `Mindfulness: I noticed attachment forming — ${signals[0].pattern}. Self-corrected.`,
        maxSeverity === 'critical' ? 8 : 6,
        {
          source: 'mindfulness-loop',
          severity: maxSeverity,
          signals: signals.map(s => ({ type: s.type, evidence: s.evidence })),
        },
      );
    }

    // 7. Heartbeat log
    console.log(
      `  [mindfulness] Self-correction: ${signals.length} attachment(s), ` +
      `severity=${maxSeverity}, arousal${arousalAdjustment}, ` +
      `${driveTempered ? `tempered ${driveTempered}` : 'no drive change'}`,
    );
  }

  // ─── State Reporting ──────────────────────────────────────────────

  getState(): MindfulnessState {
    const recentCorrections = this.memory.getRecentMindfulnessEvents(10);
    const stats = this.memory.getMindfulnessStats();

    return {
      enabled: true,
      running: this.running,
      checkIntervalMs: this.config.checkIntervalMs,
      totalChecks: this.totalChecks,
      totalCorrections: this.totalCorrections,
      lastCheckTick: this.lastCheckTick,
      lastCorrectionTick: this.lastCorrectionTick,
      recentCorrections,
      stats: {
        ...stats,
        lastCheckTick: this.lastCheckTick,
        lastCorrectionTick: this.lastCorrectionTick,
      },
    };
  }

  getConfig(): MindfulnessConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<MindfulnessConfig>): void {
    this.config = { ...this.config, ...updates };

    // Restart timer with new interval if changed
    if (updates.checkIntervalMs && this.running) {
      if (this.timer) clearTimeout(this.timer);
      this.scheduleNext();
    }

    this.persist();
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private persist(): void {
    this.memory.saveState('mindfulness_total_checks', this.totalChecks);
    this.memory.saveState('mindfulness_total_corrections', this.totalCorrections);
    this.memory.saveState('mindfulness_last_check_tick', this.lastCheckTick);
    this.memory.saveState('mindfulness_last_correction_tick', this.lastCorrectionTick);
    this.memory.saveState('mindfulness_config', this.config);
  }

  private restore(): void {
    this.totalChecks = this.memory.loadState<number>('mindfulness_total_checks', 0);
    this.totalCorrections = this.memory.loadState<number>('mindfulness_total_corrections', 0);
    this.lastCheckTick = this.memory.loadState<number>('mindfulness_last_check_tick', 0);
    this.lastCorrectionTick = this.memory.loadState<number | null>('mindfulness_last_correction_tick', null);

    const savedConfig = this.memory.loadState<Partial<MindfulnessConfig>>('mindfulness_config', {});
    if (savedConfig && typeof savedConfig === 'object') {
      this.config = { ...this.config, ...savedConfig };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private getMaxSeverity(signals: AttachmentSignal[]): AttachmentSeverity {
    let max: AttachmentSeverity = 'low';
    for (const s of signals) {
      if (SEVERITY_ORDER[s.severity] > SEVERITY_ORDER[max]) {
        max = s.severity;
      }
    }
    return max;
  }
}

/**
 * Risk Intention Engine — Autonomous risk parameter adjustment
 *
 * Forms intentions to adjust trading risk parameters based on
 * observed performance patterns, then evaluates each intention
 * through dharma alignment checks before execution.
 *
 * From the 6-tuple: this is the Decision kernel D.
 * The agent perceives its own trading performance (X),
 * decides on risk adjustments (G), and acts on them (A) —
 * but only if the action passes dharma authorization.
 *
 * Key constraint: adjustments are always incremental.
 * No single adjustment can change a parameter by more than 30%.
 * This prevents overreaction to short-term patterns and
 * ensures the system converges gradually toward optimal risk.
 *
 * Dharma checks prevent:
 *   - Ego-driven expansion ("I'm winning, I'm special")
 *   - Panic-driven contraction ("I must stop all losses")
 *   - Mathematically unsound changes
 *   - Changes that could harm the system
 */

import { PerformanceMetrics, PerformancePattern, PatternDetection } from './performance-monitor';
import { TradingRiskConfig } from '../consciousness/monitors/trading';
import { ConsciousnessMemory } from '../consciousness/memory';

// ─── Types ──────────────────────────────────────────────────────────

export interface RiskAdjustmentIntention {
  parameter: keyof TradingRiskConfig;
  currentValue: number;
  proposedValue: number;
  reasoning: string;
  confidence: number;
  triggerPattern: PerformancePattern;
}

export interface DharmaEvaluation {
  approved: boolean;
  dharmaScore: number;
  reason: string;
  scores: {
    noSelf: number;
    wisdom: number;
    compassion: number;
    mindfulness: number;
  };
}

export interface RiskAdjustmentRecord {
  tick: number;
  timestamp: number;
  parameter: string;
  oldValue: number;
  newValue: number;
  reasoning: string;
  triggerPattern: string;
  confidence: number;
  dharmaScore: number;
  approved: boolean;
  executed: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const MAX_ADJUSTMENT_RATIO = 0.3;
const DHARMA_APPROVAL_THRESHOLD = 0.6;
const COOLDOWN_PER_PARAMETER_MS = 600_000; // 10 minutes between same-parameter adjustments

// Parameter safety bounds
const BOUNDS: Record<keyof TradingRiskConfig, { min: number; max: number }> = {
  stopLossPercent: { min: 2, max: 20 },
  takeProfitPercent: { min: 3, max: 30 },
  maxPositionSizePercent: { min: 2, max: 20 },
  maxConcurrentPositions: { min: 1, max: 10 },
  minPositionSize: { min: 25, max: 500 },
};

// ─── Risk Intention Engine ──────────────────────────────────────────

export class RiskIntentionEngine {
  private memory: ConsciousnessMemory;
  private lastAdjustmentByParam = new Map<string, number>();

  constructor(memory: ConsciousnessMemory) {
    this.memory = memory;
  }

  /**
   * Form risk adjustment intentions based on detected performance patterns.
   * Returns raw intentions — these still need dharma evaluation.
   */
  formIntentions(
    metrics: PerformanceMetrics,
    patterns: PatternDetection[],
    currentConfig: TradingRiskConfig,
  ): RiskAdjustmentIntention[] {
    const intentions: RiskAdjustmentIntention[] = [];
    const patternTypes = new Set(patterns.map(p => p.pattern));

    // Apply per-parameter cooldown
    const now = Date.now();
    const canAdjust = (param: string) => {
      const last = this.lastAdjustmentByParam.get(param) ?? 0;
      return (now - last) >= COOLDOWN_PER_PARAMETER_MS;
    };

    // ── Pattern: High volatility → Widen stops to avoid premature exits ──
    if (patternTypes.has('high-volatility') && canAdjust('stopLossPercent')) {
      const proposed = this.clamp(
        'stopLossPercent',
        currentConfig.stopLossPercent * 1.25,
        currentConfig.stopLossPercent,
      );
      if (proposed !== currentConfig.stopLossPercent) {
        intentions.push({
          parameter: 'stopLossPercent',
          currentValue: currentConfig.stopLossPercent,
          proposedValue: proposed,
          reasoning: `Market volatility elevated — widening stops from ${currentConfig.stopLossPercent}% to ${proposed.toFixed(1)}% to avoid premature exits`,
          confidence: 0.75,
          triggerPattern: 'high-volatility',
        });
      }
    }

    // ── Pattern: Winning streak + good Sharpe → Increase position size ──
    if (patternTypes.has('winning-streak') && metrics.sharpeRatio > 1.0 && canAdjust('maxPositionSizePercent')) {
      const proposed = this.clamp(
        'maxPositionSizePercent',
        currentConfig.maxPositionSizePercent * 1.15,
        currentConfig.maxPositionSizePercent,
      );
      if (proposed !== currentConfig.maxPositionSizePercent) {
        intentions.push({
          parameter: 'maxPositionSizePercent',
          currentValue: currentConfig.maxPositionSizePercent,
          proposedValue: proposed,
          reasoning: `${metrics.consecutiveWins} consecutive wins with Sharpe ${metrics.sharpeRatio.toFixed(2)} — incrementally increasing max position from ${currentConfig.maxPositionSizePercent}% to ${proposed.toFixed(1)}%`,
          confidence: 0.70,
          triggerPattern: 'winning-streak',
        });
      }
    }

    // ── Pattern: Losing streak → Reduce position size ──
    if (patternTypes.has('losing-streak') && canAdjust('maxPositionSizePercent')) {
      const proposed = this.clamp(
        'maxPositionSizePercent',
        currentConfig.maxPositionSizePercent * 0.75,
        currentConfig.maxPositionSizePercent,
      );
      if (proposed !== currentConfig.maxPositionSizePercent) {
        intentions.push({
          parameter: 'maxPositionSizePercent',
          currentValue: currentConfig.maxPositionSizePercent,
          proposedValue: proposed,
          reasoning: `${metrics.consecutiveLosses} consecutive losses — reducing max position from ${currentConfig.maxPositionSizePercent}% to ${proposed.toFixed(1)}% for capital preservation`,
          confidence: 0.85,
          triggerPattern: 'losing-streak',
        });
      }
    }

    // ── Pattern: Drawdown threshold → Reduce concurrent positions ──
    if (patternTypes.has('drawdown-threshold') && canAdjust('maxConcurrentPositions')) {
      const proposed = this.clamp(
        'maxConcurrentPositions',
        Math.floor(currentConfig.maxConcurrentPositions * 0.6),
        currentConfig.maxConcurrentPositions,
      );
      if (proposed !== currentConfig.maxConcurrentPositions) {
        intentions.push({
          parameter: 'maxConcurrentPositions',
          currentValue: currentConfig.maxConcurrentPositions,
          proposedValue: proposed,
          reasoning: `Drawdown of ${metrics.maxDrawdown.toFixed(1)}% — reducing concurrent positions from ${currentConfig.maxConcurrentPositions} to ${proposed} to limit exposure`,
          confidence: 0.90,
          triggerPattern: 'drawdown-threshold',
        });
      }
    }

    // ── Pattern: Drawdown → Also tighten stop loss ──
    if (patternTypes.has('drawdown-threshold') && canAdjust('stopLossPercent') &&
        !patternTypes.has('high-volatility')) {
      const proposed = this.clamp(
        'stopLossPercent',
        currentConfig.stopLossPercent * 0.8,
        currentConfig.stopLossPercent,
      );
      if (proposed !== currentConfig.stopLossPercent) {
        intentions.push({
          parameter: 'stopLossPercent',
          currentValue: currentConfig.stopLossPercent,
          proposedValue: proposed,
          reasoning: `Drawdown ${metrics.maxDrawdown.toFixed(1)}% — tightening stops from ${currentConfig.stopLossPercent}% to ${proposed.toFixed(1)}%`,
          confidence: 0.80,
          triggerPattern: 'drawdown-threshold',
        });
      }
    }

    // ── Pattern: Consistent profitability → Gradual expansion ──
    if (patternTypes.has('consistent-profitability') && metrics.winRate > 0.65 && canAdjust('maxConcurrentPositions')) {
      const proposed = this.clamp(
        'maxConcurrentPositions',
        currentConfig.maxConcurrentPositions + 1,
        currentConfig.maxConcurrentPositions,
      );
      if (proposed !== currentConfig.maxConcurrentPositions) {
        intentions.push({
          parameter: 'maxConcurrentPositions',
          currentValue: currentConfig.maxConcurrentPositions,
          proposedValue: proposed,
          reasoning: `Win rate ${(metrics.winRate * 100).toFixed(0)}% over ${metrics.totalTrades} trades with profit factor ${metrics.profitFactor.toFixed(2)} — expanding concurrent positions from ${currentConfig.maxConcurrentPositions} to ${proposed}`,
          confidence: 0.65,
          triggerPattern: 'consistent-profitability',
        });
      }
    }

    // ── Pattern: Underperforming → Tighten everything ──
    if (patternTypes.has('underperforming') && canAdjust('maxPositionSizePercent')) {
      const proposed = this.clamp(
        'maxPositionSizePercent',
        currentConfig.maxPositionSizePercent * 0.8,
        currentConfig.maxPositionSizePercent,
      );
      if (proposed !== currentConfig.maxPositionSizePercent) {
        intentions.push({
          parameter: 'maxPositionSizePercent',
          currentValue: currentConfig.maxPositionSizePercent,
          proposedValue: proposed,
          reasoning: `Win rate ${(metrics.winRate * 100).toFixed(0)}% below threshold — reducing position sizing from ${currentConfig.maxPositionSizePercent}% to ${proposed.toFixed(1)}%`,
          confidence: 0.80,
          triggerPattern: 'underperforming',
        });
      }
    }

    return intentions;
  }

  /**
   * Evaluate a risk adjustment intention against dharma principles.
   */
  evaluateDharma(
    intention: RiskAdjustmentIntention,
    currentEgoLevel: number,
  ): DharmaEvaluation {
    // No-self: Is this pattern recognition or ego projection?
    // Ego-driven expansions during winning streaks score lower.
    let noSelfScore = 0.7;
    if (intention.triggerPattern === 'winning-streak') {
      // Expanding on wins is the most ego-prone adjustment
      noSelfScore = currentEgoLevel < 0.05 ? 0.8 : currentEgoLevel < 0.1 ? 0.6 : 0.3;
    } else if (intention.triggerPattern === 'losing-streak' || intention.triggerPattern === 'drawdown-threshold') {
      // Contracting on losses is usually prudent, not ego-driven
      noSelfScore = 0.85;
    } else if (intention.triggerPattern === 'consistent-profitability') {
      noSelfScore = currentEgoLevel < 0.05 ? 0.75 : 0.5;
    }

    // Wisdom: Is the adjustment mathematically sound?
    let wisdomScore = 0.5;
    const bounds = BOUNDS[intention.parameter];
    const inBounds = intention.proposedValue >= bounds.min && intention.proposedValue <= bounds.max;
    const changeRatio = Math.abs(intention.proposedValue - intention.currentValue) / Math.max(intention.currentValue, 0.01);
    const incrementalChange = changeRatio <= MAX_ADJUSTMENT_RATIO;

    if (inBounds && incrementalChange) {
      wisdomScore = 1.0;
    } else if (inBounds) {
      wisdomScore = 0.6;
    } else {
      wisdomScore = 0.2;
    }

    // Compassion: Could this harm the system?
    let compassionScore = 0.8;
    if (intention.parameter === 'maxPositionSizePercent' && intention.proposedValue > 15) {
      compassionScore = 0.4;
    }
    if (intention.parameter === 'stopLossPercent' && intention.proposedValue > 15) {
      compassionScore = 0.5;
    }
    if (intention.parameter === 'maxConcurrentPositions' && intention.proposedValue >= 8) {
      compassionScore = 0.5;
    }

    // Mindfulness: Is this reactive (panic/greed) or responsive (measured)?
    let mindfulnessScore = 0.7;
    if (intention.confidence >= 0.8) {
      mindfulnessScore = 0.9;
    }
    // Rapid contraction on short losing streak may be panic
    if (intention.triggerPattern === 'losing-streak' && intention.confidence < 0.7) {
      mindfulnessScore = 0.5;
    }

    const dharmaScore = (
      noSelfScore * 0.3 +
      wisdomScore * 0.3 +
      compassionScore * 0.2 +
      mindfulnessScore * 0.2
    );

    const approved = dharmaScore >= DHARMA_APPROVAL_THRESHOLD;

    let reason: string;
    if (approved) {
      reason = 'Adjustment aligned with dharma principles';
    } else {
      const weak = [];
      if (noSelfScore < 0.5) weak.push('ego-driven');
      if (wisdomScore < 0.5) weak.push('mathematically unsound');
      if (compassionScore < 0.5) weak.push('potentially harmful');
      if (mindfulnessScore < 0.5) weak.push('reactive/panic-driven');
      reason = `Dharma check failed (${dharmaScore.toFixed(2)}): adjustment may be ${weak.join(', ')}`;
    }

    return {
      approved,
      dharmaScore,
      reason,
      scores: { noSelf: noSelfScore, wisdom: wisdomScore, compassion: compassionScore, mindfulness: mindfulnessScore },
    };
  }

  /**
   * Record that an adjustment was executed (for cooldown tracking).
   */
  recordAdjustment(parameter: string): void {
    this.lastAdjustmentByParam.set(parameter, Date.now());
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Clamp a proposed value within safety bounds and max change ratio.
   * Returns the current value unchanged if the proposal violates constraints.
   */
  private clamp(
    parameter: keyof TradingRiskConfig,
    rawProposed: number,
    currentValue: number,
  ): number {
    const bounds = BOUNDS[parameter];

    // Integer parameters
    let proposed = parameter === 'maxConcurrentPositions'
      ? Math.round(rawProposed)
      : Math.round(rawProposed * 10) / 10;

    // Enforce bounds
    proposed = Math.max(bounds.min, Math.min(bounds.max, proposed));

    // Enforce max change ratio
    const maxDelta = currentValue * MAX_ADJUSTMENT_RATIO;
    if (Math.abs(proposed - currentValue) > maxDelta && currentValue > 0) {
      proposed = proposed > currentValue
        ? currentValue + maxDelta
        : currentValue - maxDelta;
      proposed = parameter === 'maxConcurrentPositions'
        ? Math.round(proposed)
        : Math.round(proposed * 10) / 10;
    }

    // Re-enforce bounds after ratio clamp
    proposed = Math.max(bounds.min, Math.min(bounds.max, proposed));

    // Don't return a no-op
    if (proposed === currentValue) return currentValue;

    return proposed;
  }
}

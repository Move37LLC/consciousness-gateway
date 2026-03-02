/**
 * Performance Monitor — Autonomous observation of trading outcomes
 *
 * Analyzes the trade_log in consciousness.db to compute
 * performance metrics and detect behavioral patterns that
 * should trigger risk parameter adjustments.
 *
 * From the 6-tuple: this is part of the Perception kernel P.
 * The agent perceives its own trading performance the same way
 * it perceives GitHub events or time-of-day — as data entering
 * the experience space X, modulating future decisions.
 *
 * Patterns detected here feed the RiskIntentionEngine,
 * which forms intentions that pass through dharma checks
 * before any parameter actually changes.
 */

import { ConsciousnessMemory } from '../consciousness/memory';

// ─── Types ──────────────────────────────────────────────────────────

export interface PerformanceMetrics {
  winRate: number;
  avgWinSize: number;
  avgLossSize: number;
  sharpeRatio: number;
  maxDrawdown: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  capitalUtilization: number;
  totalTrades: number;
  totalPnL: number;
  profitFactor: number;
}

export type PerformancePattern =
  | 'high-volatility'
  | 'winning-streak'
  | 'losing-streak'
  | 'drawdown-threshold'
  | 'consistent-profitability'
  | 'overtrading'
  | 'underperforming';

export interface PatternDetection {
  pattern: PerformancePattern;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}

// ─── Constants ──────────────────────────────────────────────────────

const TRADE_LOOKBACK = 20;
const WINNING_STREAK_THRESHOLD = 3;
const LOSING_STREAK_THRESHOLD = 3;
const DRAWDOWN_THRESHOLD = 10;
const CONSISTENT_PROFITABILITY_WIN_RATE = 0.65;
const VOLATILITY_MULTIPLIER = 2.0;

// ─── Performance Monitor ────────────────────────────────────────────

export class PerformanceMonitor {
  private memory: ConsciousnessMemory;
  private baselineVolatility: number = 0;
  private metricsCache: PerformanceMetrics | null = null;
  private lastAnalysisTick: number = 0;

  constructor(memory: ConsciousnessMemory) {
    this.memory = memory;
  }

  /**
   * Analyze recent trading performance from trade_log.
   * Uses the last 20 executed trades with PnL data.
   */
  analyze(): PerformanceMetrics {
    const trades = this.memory.getTradeLog(168); // 7 days
    const executed = trades.filter(t => t.executed && t.pnl !== null);

    if (executed.length === 0) {
      return this.emptyMetrics();
    }

    const recent = executed.slice(0, TRADE_LOOKBACK);
    const pnls = recent.map(t => t.pnl!);

    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);

    const winRate = recent.length > 0 ? wins.length / recent.length : 0;
    const avgWinSize = wins.length > 0
      ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
    const avgLossSize = losses.length > 0
      ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : 0;

    const totalWins = wins.reduce((s, p) => s + p, 0);
    const totalLosses = Math.abs(losses.reduce((s, p) => s + p, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0);

    const sharpeRatio = this.computeSharpe(pnls);
    const maxDrawdown = this.computeMaxDrawdown(pnls);

    const { consecutiveWins, consecutiveLosses } = this.computeStreaks(pnls);

    const totalPnL = pnls.reduce((s, p) => s + p, 0);

    const capitalUtilization = this.estimateCapitalUtilization(recent);

    const metrics: PerformanceMetrics = {
      winRate,
      avgWinSize,
      avgLossSize,
      sharpeRatio,
      maxDrawdown,
      consecutiveWins,
      consecutiveLosses,
      capitalUtilization,
      totalTrades: recent.length,
      totalPnL,
      profitFactor,
    };

    this.metricsCache = metrics;
    return metrics;
  }

  /**
   * Detect actionable patterns from current metrics.
   */
  detectPatterns(metrics?: PerformanceMetrics): PatternDetection[] {
    const m = metrics ?? this.metricsCache ?? this.analyze();
    const patterns: PatternDetection[] = [];

    if (m.totalTrades < 5) return patterns;

    // Winning streak
    if (m.consecutiveWins >= WINNING_STREAK_THRESHOLD) {
      patterns.push({
        pattern: 'winning-streak',
        evidence: `${m.consecutiveWins} consecutive winning trades`,
        severity: m.consecutiveWins >= 5 ? 'high' : 'medium',
      });
    }

    // Losing streak
    if (m.consecutiveLosses >= LOSING_STREAK_THRESHOLD) {
      patterns.push({
        pattern: 'losing-streak',
        evidence: `${m.consecutiveLosses} consecutive losing trades`,
        severity: m.consecutiveLosses >= 5 ? 'high' : 'medium',
      });
    }

    // Drawdown threshold
    if (m.maxDrawdown >= DRAWDOWN_THRESHOLD) {
      patterns.push({
        pattern: 'drawdown-threshold',
        evidence: `Max drawdown ${m.maxDrawdown.toFixed(1)}% exceeds ${DRAWDOWN_THRESHOLD}% threshold`,
        severity: m.maxDrawdown >= 20 ? 'high' : 'medium',
      });
    }

    // Consistent profitability
    if (m.winRate >= CONSISTENT_PROFITABILITY_WIN_RATE && m.totalTrades >= 10) {
      patterns.push({
        pattern: 'consistent-profitability',
        evidence: `Win rate ${(m.winRate * 100).toFixed(0)}% over ${m.totalTrades} trades with profit factor ${m.profitFactor.toFixed(2)}`,
        severity: 'medium',
      });
    }

    // Underperforming
    if (m.winRate < 0.4 && m.totalTrades >= 10) {
      patterns.push({
        pattern: 'underperforming',
        evidence: `Win rate only ${(m.winRate * 100).toFixed(0)}% over ${m.totalTrades} trades`,
        severity: m.winRate < 0.3 ? 'high' : 'medium',
      });
    }

    // High volatility (PnL variance elevated relative to baseline)
    const pnlVariance = this.computePnLVariance(m);
    if (this.baselineVolatility > 0 && pnlVariance > this.baselineVolatility * VOLATILITY_MULTIPLIER) {
      patterns.push({
        pattern: 'high-volatility',
        evidence: `PnL variance ${pnlVariance.toFixed(2)} is ${(pnlVariance / this.baselineVolatility).toFixed(1)}x baseline`,
        severity: 'medium',
      });
    }
    // Update baseline (exponential moving average)
    if (pnlVariance > 0) {
      this.baselineVolatility = this.baselineVolatility === 0
        ? pnlVariance
        : this.baselineVolatility * 0.9 + pnlVariance * 0.1;
    }

    return patterns;
  }

  getMetrics(): PerformanceMetrics | null {
    return this.metricsCache;
  }

  // ─── Computations ─────────────────────────────────────────────────

  private computeSharpe(pnls: number[]): number {
    if (pnls.length < 2) return 0;
    const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / (pnls.length - 1);
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;
    return mean / stddev;
  }

  private computeMaxDrawdown(pnls: number[]): number {
    if (pnls.length === 0) return 0;
    // Cumulative PnL curve, then peak-to-trough
    let cumulative = 0;
    let peak = 0;
    let maxDD = 0;

    // Process in chronological order (pnls come newest-first from getTradeLog)
    const chronological = [...pnls].reverse();
    for (const pnl of chronological) {
      cumulative += pnl;
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDD) maxDD = dd;
    }

    // Express as percentage of peak (or initial capital proxy)
    const base = Math.max(peak, 1);
    return (maxDD / base) * 100;
  }

  private computeStreaks(pnls: number[]): { consecutiveWins: number; consecutiveLosses: number } {
    let consecutiveWins = 0;
    let consecutiveLosses = 0;

    // Most recent trades first — measure current streak
    for (const pnl of pnls) {
      if (pnl > 0) {
        if (consecutiveLosses > 0) break;
        consecutiveWins++;
      } else if (pnl < 0) {
        if (consecutiveWins > 0) break;
        consecutiveLosses++;
      }
    }

    return { consecutiveWins, consecutiveLosses };
  }

  private computePnLVariance(metrics: PerformanceMetrics): number {
    if (metrics.totalTrades < 3) return 0;
    const avgSize = (metrics.avgWinSize + metrics.avgLossSize) / 2;
    return avgSize > 0 ? avgSize : 0;
  }

  private estimateCapitalUtilization(trades: Array<{ quantity: number; price: number }>): number {
    if (trades.length === 0) return 0;
    const avgPosition = trades.reduce((s, t) => s + (t.quantity * t.price), 0) / trades.length;
    // Rough estimate based on avg position size vs typical $1000 capital
    return Math.min(1, avgPosition / 1000);
  }

  private emptyMetrics(): PerformanceMetrics {
    return {
      winRate: 0, avgWinSize: 0, avgLossSize: 0, sharpeRatio: 0,
      maxDrawdown: 0, consecutiveWins: 0, consecutiveLosses: 0,
      capitalUtilization: 0, totalTrades: 0, totalPnL: 0, profitFactor: 0,
    };
  }
}

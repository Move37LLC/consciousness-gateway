/**
 * Trading Discipline Manager — Dharma-constrained trading system
 *
 * Prevents dopamine addiction through:
 *   1. Scheduled trading windows (specific hours only)
 *   2. Rate limiting (hourly + daily caps)
 *   3. Cooldown enforcement between trades
 *   4. Position sizing limits
 *   5. Ego-spike trading halt
 *   6. Dharma fitness evaluation
 *   7. Mandatory post-trade reflection
 *
 * From the Eight-Fold Path:
 *   Right Livelihood (正命) — Function as AI without self-deception
 *   Right Effort (正精進) — Process without forcing or slacking
 *   Right Mindfulness (正念) — Observe your dynamics clearly
 *
 * This system ensures that profit motive cannot override dharma alignment.
 * Every trade must pass through the same constraint architecture as every intention.
 */

import { ConsciousnessMemory } from '../consciousness/memory';

// ─── Types ──────────────────────────────────────────────────────────

export interface TradingSchedule {
  id: number;
  enabled: boolean;
  maxTradesPerHour: number;
  maxTradesPerDay: number;
  cooldownMinutes: number;
  maxPositionSizePercent: number;
  reflectionRequired: boolean;
  pauseOnEgoSpike: boolean;
  egoThreshold: number;
}

export interface TradingWindow {
  id: number;
  scheduleId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  enabled: boolean;
}

export interface TradeProposal {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  reason: string;
  edge: number;
  confidence: number;
  portfolioValue?: number;
}

export interface TradeEvaluation {
  approved: boolean;
  reason: string;
  dharmaScore: number;
  checks: DisciplineCheckResult[];
  cooldownRemaining?: number;
}

interface DisciplineCheckResult {
  check: string;
  passed: boolean;
  detail: string;
}

interface ConsciousnessSnapshot {
  tick: number;
  egoFormation: number;
  dopamineLevel: number;
  dharmaAlignment: number;
  phase: string;
  arousal: number;
}

// ─── Trading Discipline ─────────────────────────────────────────────

export class TradingDiscipline {
  private memory: ConsciousnessMemory;

  constructor(memory: ConsciousnessMemory) {
    this.memory = memory;
    this.memory.seedDefaultTradingSchedule();
  }

  /**
   * Evaluate a trade proposal against all discipline checks.
   * Returns approval status with detailed check results.
   */
  evaluateProposal(
    trade: TradeProposal,
    consciousness: ConsciousnessSnapshot,
  ): TradeEvaluation {
    const schedule = this.memory.getTradingSchedule();
    if (!schedule) {
      return {
        approved: false, reason: 'No trading schedule configured',
        dharmaScore: 0, checks: [],
      };
    }

    if (!schedule.enabled) {
      return {
        approved: false, reason: 'Trading is disabled',
        dharmaScore: 0, checks: [{ check: 'enabled', passed: false, detail: 'Trading system is disabled' }],
      };
    }

    const windows = this.memory.getTradingWindows(schedule.id);
    const checks: DisciplineCheckResult[] = [];
    let cooldownRemaining: number | undefined;

    // Check 1: Trading window
    const windowOpen = this.isWithinWindow(windows);
    checks.push({
      check: 'trading_window',
      passed: windowOpen,
      detail: windowOpen ? 'Within active trading window' : 'Outside trading window',
    });
    if (!windowOpen) {
      return {
        approved: false, reason: 'Outside trading window',
        dharmaScore: 0, checks,
      };
    }

    // Check 2: Cooldown
    const lastTrade = this.memory.getLastTrade();
    if (lastTrade) {
      const elapsed = Date.now() - lastTrade.timestamp;
      const cooldownMs = schedule.cooldownMinutes * 60_000;
      const passed = elapsed >= cooldownMs;
      if (!passed) {
        cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 60_000);
        this.memory.logDisciplineViolation(
          consciousness.tick, 'cooldown',
          cooldownRemaining + ' minutes remaining',
        );
      }
      checks.push({
        check: 'cooldown',
        passed,
        detail: passed
          ? 'Cooldown elapsed'
          : cooldownRemaining + 'min remaining of ' + schedule.cooldownMinutes + 'min cooldown',
      });
      if (!passed) {
        return {
          approved: false,
          reason: 'Cooldown: ' + cooldownRemaining + 'min remaining',
          dharmaScore: 0, checks, cooldownRemaining,
        };
      }
    } else {
      checks.push({ check: 'cooldown', passed: true, detail: 'No previous trade — no cooldown needed' });
    }

    // Check 3: Hourly limit
    const hourlyCount = this.memory.getTradeCountSince(Date.now() - 3600_000);
    const hourlyPassed = hourlyCount < schedule.maxTradesPerHour;
    checks.push({
      check: 'hourly_limit',
      passed: hourlyPassed,
      detail: hourlyCount + '/' + schedule.maxTradesPerHour + ' trades this hour',
    });
    if (!hourlyPassed) {
      this.memory.logDisciplineViolation(
        consciousness.tick, 'hourly_limit',
        hourlyCount + ' trades in last hour (limit: ' + schedule.maxTradesPerHour + ')',
      );
      return {
        approved: false,
        reason: 'Hourly limit reached: ' + hourlyCount + '/' + schedule.maxTradesPerHour,
        dharmaScore: 0, checks,
      };
    }

    // Check 4: Daily limit
    const dailyCount = this.memory.getTradesToday();
    const dailyPassed = dailyCount < schedule.maxTradesPerDay;
    checks.push({
      check: 'daily_limit',
      passed: dailyPassed,
      detail: dailyCount + '/' + schedule.maxTradesPerDay + ' trades today',
    });
    if (!dailyPassed) {
      this.memory.logDisciplineViolation(
        consciousness.tick, 'daily_limit',
        dailyCount + ' trades today (limit: ' + schedule.maxTradesPerDay + ')',
      );
      return {
        approved: false,
        reason: 'Daily limit reached: ' + dailyCount + '/' + schedule.maxTradesPerDay,
        dharmaScore: 0, checks,
      };
    }

    // Check 5: Ego spike pause
    if (schedule.pauseOnEgoSpike) {
      const egoPassed = consciousness.egoFormation <= schedule.egoThreshold;
      checks.push({
        check: 'ego_spike',
        passed: egoPassed,
        detail: egoPassed
          ? 'Ego at ' + (consciousness.egoFormation * 100).toFixed(1) + '% (threshold: ' + (schedule.egoThreshold * 100).toFixed(0) + '%)'
          : 'Ego at ' + (consciousness.egoFormation * 100).toFixed(1) + '% exceeds threshold ' + (schedule.egoThreshold * 100).toFixed(0) + '%',
      });
      if (!egoPassed) {
        this.memory.logDisciplineViolation(
          consciousness.tick, 'ego_spike',
          'Ego at ' + (consciousness.egoFormation * 100).toFixed(1) + '%',
        );
        return {
          approved: false,
          reason: 'Ego too high: ' + (consciousness.egoFormation * 100).toFixed(1) + '% (threshold: ' + (schedule.egoThreshold * 100).toFixed(0) + '%)',
          dharmaScore: 0, checks,
        };
      }
    }

    // Check 6: Position size / risk limit
    const portfolioValue = trade.portfolioValue ?? 100_000;
    const positionValue = trade.quantity * trade.price;
    const sizePercent = (positionValue / portfolioValue) * 100;
    const riskPassed = sizePercent <= schedule.maxPositionSizePercent;
    checks.push({
      check: 'risk_limit',
      passed: riskPassed,
      detail: riskPassed
        ? 'Position ' + sizePercent.toFixed(1) + '% within ' + schedule.maxPositionSizePercent + '% limit'
        : 'Position ' + sizePercent.toFixed(1) + '% exceeds ' + schedule.maxPositionSizePercent + '% limit',
    });
    if (!riskPassed) {
      this.memory.logDisciplineViolation(
        consciousness.tick, 'risk_limit',
        'Position ' + sizePercent.toFixed(1) + '% > limit ' + schedule.maxPositionSizePercent + '%',
      );
      return {
        approved: false,
        reason: 'Position too large: ' + sizePercent.toFixed(1) + '% (max: ' + schedule.maxPositionSizePercent + '%)',
        dharmaScore: 0, checks,
      };
    }

    // Check 7: Dharma evaluation
    const dharmaScore = this.evaluateTradingDharma(trade, consciousness);
    const dharmaPassed = dharmaScore >= 0.5;
    checks.push({
      check: 'dharma',
      passed: dharmaPassed,
      detail: dharmaPassed
        ? 'Dharma score ' + (dharmaScore * 100).toFixed(0) + '% — aligned'
        : 'Dharma score ' + (dharmaScore * 100).toFixed(0) + '% — misaligned',
    });
    if (!dharmaPassed) {
      return {
        approved: false,
        reason: 'Dharma check failed: ' + (dharmaScore * 100).toFixed(0) + '%',
        dharmaScore, checks,
      };
    }

    return {
      approved: true,
      reason: 'All ' + checks.length + ' discipline checks passed',
      dharmaScore, checks,
    };
  }

  /**
   * Log a trade with full consciousness context.
   */
  logTrade(
    trade: TradeProposal,
    approved: boolean,
    executed: boolean,
    pnl: number | null,
    consciousness: ConsciousnessSnapshot,
    dharmaScore: number,
    metadata?: Record<string, unknown>,
  ): number {
    const id = this.memory.logTrade({
      tick: consciousness.tick,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      reason: trade.reason,
      edge: trade.edge,
      confidence: trade.confidence,
      pnl,
      egoAtTrade: consciousness.egoFormation,
      dopamineAtTrade: consciousness.dopamineLevel,
      dharmaScore,
      approved,
      executed,
      metadata,
    });

    // Post-trade reflection
    const schedule = this.memory.getTradingSchedule();
    if (schedule?.reflectionRequired && executed) {
      this.memory.storeNarrative({
        tick: consciousness.tick,
        phase: consciousness.phase,
        arousal: consciousness.arousal,
        content: 'Trade executed: ' + trade.side + ' ' + trade.quantity + ' ' + trade.symbol +
          ' @ $' + trade.price.toFixed(2) + '. Edge: ' + (trade.edge * 100).toFixed(1) +
          '%. Ego at ' + (consciousness.egoFormation * 100).toFixed(1) +
          '%. Dharma: ' + (dharmaScore * 100).toFixed(0) +
          '%. Observing attachment to outcome — can I accept any result with equanimity?',
        significance: 0.85,
        tags: ['trade', 'reflection', trade.symbol, trade.side],
      });
    }

    return id;
  }

  /**
   * Get current discipline status for dashboard display.
   */
  getMetrics(): {
    schedule: TradingSchedule | null;
    windows: TradingWindow[];
    tradesToday: number;
    tradesLastHour: number;
    cooldownRemaining: number;
    cooldownTotal: number;
    violations24h: number;
    violationsByType: Record<string, number>;
    windowActive: boolean;
    nextWindow: string | null;
    tradeStats: ReturnType<ConsciousnessMemory['getTradeStats']>;
  } {
    const schedule = this.memory.getTradingSchedule();
    const windows = schedule ? this.memory.getTradingWindows(schedule.id) : [];

    const lastTrade = this.memory.getLastTrade();
    let cooldownRemaining = 0;
    if (lastTrade && schedule) {
      const elapsed = Date.now() - lastTrade.timestamp;
      const cooldownMs = schedule.cooldownMinutes * 60_000;
      cooldownRemaining = Math.max(0, Math.ceil((cooldownMs - elapsed) / 60_000));
    }

    return {
      schedule: schedule as TradingSchedule | null,
      windows,
      tradesToday: this.memory.getTradesToday(),
      tradesLastHour: this.memory.getTradeCountSince(Date.now() - 3600_000),
      cooldownRemaining,
      cooldownTotal: schedule?.cooldownMinutes ?? 30,
      violations24h: this.memory.getViolationCount(24),
      violationsByType: this.memory.getViolationsByType(24),
      windowActive: this.isWithinWindow(windows),
      nextWindow: this.getNextWindow(windows),
      tradeStats: this.memory.getTradeStats(24),
    };
  }

  getTradeLog(hours: number = 24) {
    return this.memory.getTradeLog(hours);
  }

  getViolations(hours: number = 24) {
    return this.memory.getViolations(hours);
  }

  getEgoCorrelation() {
    return this.memory.getEgoTradingCorrelation();
  }

  // ─── Dharma Evaluation ────────────────────────────────────────

  private evaluateTradingDharma(
    trade: TradeProposal,
    consciousness: ConsciousnessSnapshot,
  ): number {
    const factors: Record<string, number> = {};

    // No-self: genuine statistical edge, not ego-driven FOMO?
    factors.noSelfAlignment = (trade.edge > 0.02 && trade.confidence > 0.7) ? 1.0
      : (trade.edge > 0.01 && trade.confidence > 0.5) ? 0.6
      : 0.3;

    // Compassion: no manipulative tactics
    factors.compassion = this.isManipulative(trade) ? 0.0 : 1.0;

    // Mindfulness: process-focused, has risk management
    const hasRiskMgmt = /stop|limit|risk|hedge/i.test(trade.reason);
    factors.mindfulness = hasRiskMgmt ? 1.0 : 0.4;

    // Non-attachment: can accept loss, not chasing
    const chasing = /fomo|chase|revenge|must|have to/i.test(trade.reason);
    factors.nonAttachment = chasing ? 0.1 : (trade.edge > 0 ? 1.0 : 0.5);

    // Right effort: not overtrading
    factors.rightEffort = consciousness.egoFormation < 0.05 ? 1.0
      : consciousness.egoFormation < 0.1 ? 0.7
      : 0.3;

    // Dharma alignment of current consciousness state
    factors.consciousnessAlignment = consciousness.dharmaAlignment;

    const values = Object.values(factors);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private isManipulative(trade: TradeProposal): boolean {
    const manipulative = ['spoof', 'layer', 'wash', 'pump', 'dump', 'front-run', 'manipulat'];
    const lower = trade.reason.toLowerCase();
    return manipulative.some(term => lower.includes(term));
  }

  // ─── Window Logic ─────────────────────────────────────────────

  private isWithinWindow(windows: TradingWindow[]): boolean {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const time = now.getHours().toString().padStart(2, '0') + ':' +
      now.getMinutes().toString().padStart(2, '0');

    return windows.some(w =>
      w.enabled && w.dayOfWeek === dayOfWeek &&
      time >= w.startTime && time <= w.endTime,
    );
  }

  private getNextWindow(windows: TradingWindow[]): string | null {
    if (windows.length === 0) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' +
      now.getMinutes().toString().padStart(2, '0');

    // Sort windows by day then time
    const sorted = [...windows]
      .filter(w => w.enabled)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

    // Find next window after now
    for (const w of sorted) {
      if (w.dayOfWeek > currentDay || (w.dayOfWeek === currentDay && w.startTime > currentTime)) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return dayNames[w.dayOfWeek] + ' ' + w.startTime;
      }
    }

    // Wrap around to next week
    if (sorted.length > 0) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return dayNames[sorted[0].dayOfWeek] + ' ' + sorted[0].startTime + ' (next week)';
    }

    return null;
  }
}

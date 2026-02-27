/**
 * Trading Monitor — Spatial perception of trading activity
 *
 * Polls the gateway-trading events API to convert trading
 * activity (scans, opportunities, trades, exits) into
 * spatial percepts that feed the consciousness loop.
 *
 * This lets Gateway "perceive" the trading module's activity
 * the same way it perceives GitHub events or email.
 *
 * Poll interval: every 15 ticks (~15 seconds).
 * gateway-trading exposes: GET /v1/events/recent?since=<timestamp>
 */

import { MonitorPlugin, SpatialPercept } from '../types';

interface TradingEvent {
  id: string;
  type: 'scan' | 'opportunity' | 'trade' | 'exit' | 'status';
  timestamp: number;
  data: Record<string, unknown>;
}

interface EventsResponse {
  events: TradingEvent[];
  total: number;
  serverTime: number;
}

export interface TradingRiskConfig {
  stopLossPercent: number;
  takeProfitPercent: number;
  maxPositionSizePercent: number;
  maxConcurrentPositions: number;
  minPositionSize: number;
}

export interface RiskConfigResponse {
  config: TradingRiskConfig;
  warnings: string[];
}

export interface RiskConfigUpdateResponse {
  config: TradingRiskConfig;
  warnings: string[];
  changed: Record<string, { from: number; to: number }>;
}

export class TradingMonitor implements MonitorPlugin {
  readonly name = 'trading';
  readonly channel = 'trading';
  readonly pollInterval = 15;

  private tradingUrl: string;
  private lastPollTimestamp = 0;
  private initialized = false;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private pollCount = 0;
  private cachedRiskConfig: TradingRiskConfig | null = null;
  private riskConfigPollCounter = 0;

  constructor(tradingUrl?: string) {
    this.tradingUrl = tradingUrl ?? process.env.TRADING_URL ?? 'http://localhost:3001';
  }

  get available(): boolean {
    return !!this.tradingUrl;
  }

  async init(): Promise<void> {
    try {
      const res = await fetch(`${this.tradingUrl}/v1/events/health`, {
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const health = await res.json() as { status: string; events: number };
        console.log(`  [trading] Connected to gateway-trading (${health.events} events buffered)`);
        this.initialized = true;
        this.lastPollTimestamp = Date.now();
      } else {
        console.log(`  [trading] gateway-trading responded with ${res.status} — will retry on poll`);
      }
    } catch {
      console.log('  [trading] gateway-trading not available yet — will retry on poll');
    }
  }

  async poll(): Promise<SpatialPercept[]> {
    this.pollCount++;
    this.riskConfigPollCounter++;

    if (this.riskConfigPollCounter >= 10) {
      this.riskConfigPollCounter = 0;
      this.getRiskConfig().catch(() => {});
    }

    try {
      const url = `${this.tradingUrl}/v1/events/recent?since=${this.lastPollTimestamp}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        this.handleError(`HTTP ${res.status}`);
        return [];
      }

      const body = await res.json() as EventsResponse;
      this.consecutiveErrors = 0;
      this.lastError = null;

      if (!this.initialized) {
        console.log('  [trading] Connected to gateway-trading');
        this.initialized = true;
      }

      if (body.events.length === 0) return [];

      this.lastPollTimestamp = body.serverTime;

      const percepts = body.events.map(e => this.eventToPercept(e));

      if (percepts.length > 0) {
        console.log(`  [trading] Poll #${this.pollCount}: ${percepts.length} trading percept(s)`);
      }

      return percepts;
    } catch (err) {
      this.handleError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  /**
   * Fetch the current risk config + warnings from gateway-trading.
   * Returns cached value if gateway-trading is unavailable.
   */
  async getRiskConfig(): Promise<RiskConfigResponse | null> {
    try {
      const res = await fetch(`${this.tradingUrl}/v1/config/risk`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = await res.json() as RiskConfigResponse;
        this.cachedRiskConfig = body.config;
        return body;
      }
    } catch {
      // Fall through to cached
    }
    return this.cachedRiskConfig ? { config: this.cachedRiskConfig, warnings: [] } : null;
  }

  /**
   * Update risk config on gateway-trading.
   * No hard limits — advisory warnings only.
   */
  async setRiskConfig(update: Partial<TradingRiskConfig>): Promise<RiskConfigUpdateResponse | null> {
    try {
      const res = await fetch(`${this.tradingUrl}/v1/config/risk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = await res.json() as RiskConfigUpdateResponse;
        this.cachedRiskConfig = body.config;
        return body;
      }
    } catch {
      // Fall through
    }
    return null;
  }

  /**
   * Reset risk config to defaults on gateway-trading.
   */
  async resetRiskConfig(): Promise<RiskConfigResponse | null> {
    try {
      const res = await fetch(`${this.tradingUrl}/v1/config/risk/reset`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = await res.json() as RiskConfigResponse;
        this.cachedRiskConfig = body.config;
        return body;
      }
    } catch {
      // Fall through
    }
    return null;
  }

  getCachedRiskConfig(): TradingRiskConfig | null {
    return this.cachedRiskConfig;
  }

  getTradingUrl(): string {
    return this.tradingUrl;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      available: this.available,
      initialized: this.initialized,
      tradingUrl: this.tradingUrl,
      pollCount: this.pollCount,
      lastPollTimestamp: this.lastPollTimestamp,
      lastPollISO: this.lastPollTimestamp ? new Date(this.lastPollTimestamp).toISOString() : null,
      consecutiveErrors: this.consecutiveErrors,
      lastError: this.lastError,
      riskConfig: this.cachedRiskConfig,
    };
  }

  private eventToPercept(event: TradingEvent): SpatialPercept {
    return {
      source: `trading:${event.type}`,
      channel: 'trading',
      data: {
        eventId: event.id,
        eventType: event.type,
        ...event.data,
      },
      salience: this.calculateSalience(event),
      features: this.extractFeatures(event),
      timestamp: event.timestamp,
    };
  }

  private calculateSalience(event: TradingEvent): number {
    switch (event.type) {
      case 'scan':
        return event.data.mispricingsFound ? 0.4 : 0.2;

      case 'opportunity': {
        const confidence = (event.data.confidence as number) ?? 0;
        const deviation = Math.abs((event.data.deviation as number) ?? 0);
        return Math.min(1.0, 0.4 + confidence * 0.3 + deviation * 0.01);
      }

      case 'trade': {
        const pnl = event.data.pnl as number | undefined;
        if (pnl !== undefined && pnl > 0) return 1.0;
        if (pnl !== undefined && pnl < 0) return 0.85;
        return 0.9;
      }

      case 'exit': {
        const exitPnl = event.data.pnl as number | undefined;
        if (exitPnl !== undefined && exitPnl > 0) return 1.0;
        if (exitPnl !== undefined && exitPnl < 0) return 0.9;
        return 0.85;
      }

      case 'status':
        return 0.15;

      default:
        return 0.3;
    }
  }

  /**
   * 8-dimensional feature vector encoding trading event characteristics.
   * [eventType, salience, magnitude, risk, confidence, pnl, deviation, urgency]
   */
  private extractFeatures(event: TradingEvent): number[] {
    const typeMap: Record<string, number> = {
      scan: 0.1,
      opportunity: 0.4,
      trade: 0.8,
      exit: 0.9,
      status: 0.05,
    };

    const eventTypeVal = typeMap[event.type] ?? 0.5;
    const salience = this.calculateSalience(event);
    const price = (event.data.price as number) ?? 0;
    const magnitude = Math.min(1, price / 1000);
    const quantity = (event.data.quantity as number) ?? 0;
    const risk = Math.min(1, (price * quantity) / 10000);
    const confidence = (event.data.confidence as number) ?? 0;
    const pnl = (event.data.pnl as number) ?? 0;
    const pnlNorm = Math.tanh(pnl / 100);
    const deviation = Math.min(1, Math.abs((event.data.deviation as number) ?? 0) / 20);
    const urgency = event.type === 'trade' || event.type === 'exit' ? 0.9 : 0.3;

    return [eventTypeVal, salience, magnitude, risk, confidence, pnlNorm, deviation, urgency];
  }

  private handleError(msg: string): void {
    this.consecutiveErrors++;
    if (this.lastError !== msg) {
      console.log(`  [trading] Poll error: ${msg}`);
      this.lastError = msg;
    }
  }
}

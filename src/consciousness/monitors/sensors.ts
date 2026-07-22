/**
 * Sensors Monitor — Phase 3 safety scaffold (P3.0a)
 *
 * MonitorPlugin that carries physical sensation into the consciousness
 * loop through the guarded pipeline:
 *
 *   SensorSource → SensorIngressGuard → SensorArousalFilter → SpatialPercept
 *
 * P3.0a ships with the SyntheticSensorSource only (enabled via
 * SENSORS_SYNTHETIC=1) so the entire safety boundary is exercised and
 * tested BEFORE any hardware exists. Hardware drivers (RTL-SDR, GWOSC,
 * Sense HAT) later implement SensorSource and plug into this same, already
 * verified pipeline.
 *
 * Sensation percepts contribute to fusion (arousal, experience space) and
 * are choked at the IntentionEngine: they can never become intentions.
 */

import { MonitorPlugin, SpatialPercept } from '../types';
import { PhysicalReading, SensorSource } from '../sensors/types';
import { SensorIngressGuard, SensorArousalFilter, IngressStats } from '../sensors/guard';

/**
 * Synthetic physical source for scaffold validation. Emits a smooth
 * pseudo-diurnal waveform with occasional injected transients so the
 * filter's behavior is observable end-to-end without hardware.
 */
export class SyntheticSensorSource implements SensorSource {
  readonly modality = 'synthetic' as const;
  readonly dim = 8;
  private seq = 0;
  /** When set, the next read() emits a spike of this amplitude. */
  private pendingSpike: number | null = null;

  injectTransient(amplitude: number = 10): void {
    this.pendingSpike = amplitude;
  }

  read(now: number = Date.now()): PhysicalReading {
    this.seq++;
    const phase = (now % 86_400_000) / 86_400_000; // position in the day
    const base = 1 + 0.5 * Math.sin(2 * Math.PI * phase);
    const spike = this.pendingSpike ?? 0;
    this.pendingSpike = null;

    const values = Array.from({ length: this.dim }, (_, i) =>
      base * (1 + 0.05 * Math.sin(i)) + spike + (Math.random() - 0.5) * 0.02
    );

    return { modality: this.modality, values, timestamp: now, seq: this.seq };
  }
}

export class SensorsMonitor implements MonitorPlugin {
  readonly name = 'sensors';
  readonly channel = 'sensors';
  /** Poll every 15 ticks (~15s) — matches the trading monitor cadence. */
  readonly pollInterval = 15;

  private sources: SensorSource[] = [];
  private guard: SensorIngressGuard;
  private filter: SensorArousalFilter;
  private enabled: boolean;
  private perceptCount = 0;

  constructor(options?: {
    sources?: SensorSource[];
    guard?: SensorIngressGuard;
    filter?: SensorArousalFilter;
    enabled?: boolean;
  }) {
    this.guard = options?.guard ?? new SensorIngressGuard();
    this.filter = options?.filter ?? new SensorArousalFilter();

    if (options?.sources) {
      this.sources = options.sources;
      this.enabled = options.enabled ?? true;
    } else if (process.env.SENSORS_SYNTHETIC === '1') {
      // Explicit opt-in only: a plain restart never activates this channel.
      this.sources = [new SyntheticSensorSource()];
      this.enabled = true;
    } else {
      this.enabled = false;
    }
  }

  get available(): boolean {
    return this.enabled && this.sources.length > 0;
  }

  async init(): Promise<void> {
    const names = this.sources.map(s => s.modality).join(', ');
    console.log(`  [sensors] Physical sensation channel active (${names}) — sensation only, no intention path`);
  }

  async poll(): Promise<SpatialPercept[]> {
    if (!this.available) return [];
    const now = Date.now();
    const percepts: SpatialPercept[] = [];

    for (const source of this.sources) {
      let reading: PhysicalReading | null;
      try {
        reading = source.read(now);
      } catch (err) {
        console.error(`  [sensors] ${source.modality} read error:`, err);
        continue;
      }
      if (!reading) continue;

      const result = this.guard.admit(reading, now);
      if (!result.ok || !result.reading) continue; // rejection is counted in guard stats

      percepts.push(this.filter.toPercept(result.reading));
      this.perceptCount++;
    }

    return percepts;
  }

  async shutdown(): Promise<void> {
    // No hardware handles yet — nothing to release in P3.0a.
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      available: this.available,
      sources: this.sources.map(s => ({ modality: s.modality, dim: s.dim })),
      perceptCount: this.perceptCount,
      ingress: this.getIngressStats(),
    };
  }

  getIngressStats(): IngressStats {
    return this.guard.getStats();
  }
}

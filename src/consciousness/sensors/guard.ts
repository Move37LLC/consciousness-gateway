/**
 * Sensor Ingress Guard + Arousal Filter — Phase 3 safety scaffold (P3.0a)
 *
 * Layer 2 of the structural guarantee: every physical reading is validated
 * and re-built from scratch before it may become a sensation percept, and
 * its arousal contribution is filtered for BOTH physical failure modes:
 *
 *   A. TRANSIENT REJECTION — a passing truck / RF burst is a single-window
 *      spike. Its salience is capped so one transient cannot slam arousal
 *      (which would provoke spurious arousal-driven behavior). Salience is
 *      only allowed to rise when an anomaly PERSISTS across windows.
 *
 *   B. BASELINE DE-BIASING — a strong nearby transmitter or constant
 *      traffic raises the noise floor. Left uncorrected, elevated arousal
 *      would permanently CLOSE the calm-window delegation gate (the gate
 *      fires on LOW arousal). The adaptive baseline absorbs sustained
 *      elevation, so "the new normal" stops contributing arousal and the
 *      Gateway's quiet windows survive a noisy environment.
 *
 * Note the asymmetry these two create on purpose: brief spikes are damped,
 * sustained anomalies are surfaced, and permanent shifts are normalized.
 */

import {
  PhysicalReading, SensorChannelSpec, PhysicalModality,
  DEFAULT_CHANNEL_SPECS, SensationData, SENSATION_SOURCE,
} from './types';
import { SpatialPercept } from '../types';

// ─── Ingress validation ──────────────────────────────────────────────

export type IngressRejection =
  | 'unknown_modality'   // no channel spec for this modality
  | 'bad_shape'          // values missing / not an array / wrong length
  | 'non_numeric'        // NaN / Infinity / non-number element
  | 'stale'              // reading older than the channel's maxAgeMs
  | 'rate_limited';      // channel exceeded maxPerMinute this minute

export interface IngressResult {
  ok: boolean;
  /** Present when ok — a freshly-built reading (input is never reused). */
  reading?: PhysicalReading;
  rejection?: IngressRejection;
}

export interface IngressStats {
  admitted: number;
  rejected: Record<IngressRejection, number>;
}

/**
 * Validates and rate-limits physical readings per channel contract.
 * Never mutates or spreads its input: admitted readings are rebuilt
 * field-by-field so nothing beyond the declared shape can pass through.
 */
export class SensorIngressGuard {
  private specs = new Map<PhysicalModality, SensorChannelSpec>();
  private admittedTimestamps = new Map<PhysicalModality, number[]>();
  private stats: IngressStats = {
    admitted: 0,
    rejected: {
      unknown_modality: 0, bad_shape: 0, non_numeric: 0, stale: 0, rate_limited: 0,
    },
  };

  constructor(specs: SensorChannelSpec[] = DEFAULT_CHANNEL_SPECS) {
    for (const spec of specs) this.specs.set(spec.modality, spec);
  }

  admit(input: PhysicalReading, now: number = Date.now()): IngressResult {
    const spec = this.specs.get(input?.modality);
    if (!spec) return this.reject('unknown_modality');

    if (!Array.isArray(input.values) || input.values.length !== spec.dim) {
      return this.reject('bad_shape');
    }

    // Numeric-only, finite-only. Anything else is dropped, not coerced.
    for (const v of input.values) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return this.reject('non_numeric');
      }
    }

    if (typeof input.timestamp !== 'number' || !Number.isFinite(input.timestamp)
      || now - input.timestamp > spec.maxAgeMs) {
      return this.reject('stale');
    }

    // Rolling one-minute rate limit per channel.
    const window = (this.admittedTimestamps.get(spec.modality) ?? [])
      .filter(t => now - t < 60_000);
    if (window.length >= spec.maxPerMinute) {
      this.admittedTimestamps.set(spec.modality, window);
      return this.reject('rate_limited');
    }
    window.push(now);
    this.admittedTimestamps.set(spec.modality, window);

    this.stats.admitted++;
    // Rebuild from scratch — the declared fields and nothing else.
    return {
      ok: true,
      reading: {
        modality: spec.modality,
        values: input.values.slice(),
        timestamp: input.timestamp,
        seq: Number.isFinite(input.seq) ? input.seq : 0,
      },
    };
  }

  getStats(): IngressStats {
    return {
      admitted: this.stats.admitted,
      rejected: { ...this.stats.rejected },
    };
  }

  private reject(rejection: IngressRejection): IngressResult {
    this.stats.rejected[rejection]++;
    return { ok: false, rejection };
  }
}

// ─── Arousal filter ──────────────────────────────────────────────────

export interface ArousalFilterConfig {
  /** EWMA decay for the energy baseline (closer to 1 = slower adaptation). */
  baselineDecay: number;
  /** z-score above which a window counts as anomalous. */
  anomalyZ: number;
  /** Salience for a quiet, in-baseline window. */
  quietSalience: number;
  /** Salience ceiling for an ISOLATED anomaly (transient rejection cap). */
  transientSalienceCap: number;
  /** Salience ceiling for a PERSISTENT anomaly (still below notify-grade 0.8+). */
  persistentSalienceCap: number;
  /** Windows of history used to measure anomaly persistence. */
  persistenceWindow: number;
  /** Fraction of recent windows that must be anomalous to count as persistent. */
  persistenceThreshold: number;
}

export const DEFAULT_AROUSAL_FILTER_CONFIG: ArousalFilterConfig = {
  baselineDecay: 0.95,
  anomalyZ: 3.0,
  quietSalience: 0.05,
  transientSalienceCap: 0.35,
  persistentSalienceCap: 0.7,
  persistenceWindow: 10,
  persistenceThreshold: 0.6,
};

interface ModalityBaseline {
  mean: number;
  variance: number;
  samples: number;
  recentAnomalies: boolean[];
}

/**
 * Converts admitted readings into sensation percepts with filtered salience.
 * One adaptive baseline per modality.
 */
export class SensorArousalFilter {
  private config: ArousalFilterConfig;
  private baselines = new Map<PhysicalModality, ModalityBaseline>();

  constructor(config?: Partial<ArousalFilterConfig>) {
    this.config = { ...DEFAULT_AROUSAL_FILTER_CONFIG, ...config };
  }

  /** RMS energy of a reading window. */
  static energyOf(values: number[]): number {
    if (values.length === 0) return 0;
    const sumSq = values.reduce((s, v) => s + v * v, 0);
    return Math.sqrt(sumSq / values.length);
  }

  toPercept(reading: PhysicalReading): SpatialPercept {
    const energy = SensorArousalFilter.energyOf(reading.values);
    const b = this.baselines.get(reading.modality) ?? {
      mean: energy, variance: 0, samples: 0, recentAnomalies: [],
    };

    // z-score against the CURRENT baseline (before this window updates it).
    const std = Math.sqrt(Math.max(b.variance, 1e-12));
    const z = b.samples >= 3 ? (energy - b.mean) / std : 0;
    const anomalous = Math.abs(z) >= this.config.anomalyZ;

    // Persistence across the recent window.
    b.recentAnomalies.push(anomalous);
    if (b.recentAnomalies.length > this.config.persistenceWindow) {
      b.recentAnomalies.shift();
    }
    const persistence = b.recentAnomalies.length > 0
      ? b.recentAnomalies.filter(Boolean).length / b.recentAnomalies.length
      : 0;
    const persistent = persistence >= this.config.persistenceThreshold;

    // Salience: quiet → floor; isolated anomaly → transient cap;
    // sustained anomaly → persistent cap. Never notify-grade on its own.
    let salience: number;
    if (!anomalous) {
      salience = this.config.quietSalience;
    } else if (!persistent) {
      salience = this.config.transientSalienceCap;
    } else {
      salience = this.config.persistentSalienceCap;
    }

    // Baseline de-biasing: the EWMA ALWAYS absorbs the new window — even
    // anomalous ones — so a sustained shift becomes the new normal and its
    // arousal contribution decays back toward the quiet floor. This is what
    // keeps a raised noise floor from permanently suppressing the calm
    // windows the delegation gate depends on.
    const d = this.config.baselineDecay;
    const prevMean = b.mean;
    b.mean = b.samples === 0 ? energy : d * b.mean + (1 - d) * energy;
    b.variance = b.samples === 0
      ? 0
      : d * b.variance + (1 - d) * (energy - prevMean) * (energy - prevMean);
    b.samples++;
    this.baselines.set(reading.modality, b);

    const data: SensationData = {
      sensation: true,
      modality: reading.modality,
      energy,
      baselineEnergy: b.mean,
      anomalyZ: z,
      persistence,
      seq: reading.seq,
    };

    return {
      source: SENSATION_SOURCE,
      channel: `sensors:${reading.modality}`,
      data,
      salience,
      // Numeric summary only — raw samples stay out of the percept to keep
      // fusion input compact (full windows belong to the capture buffer).
      features: [
        salience,
        Math.tanh(energy),
        Math.tanh(Math.abs(z) / 6),
        persistence,
      ],
      timestamp: reading.timestamp,
    };
  }

  /** Expose baseline state for diagnostics/tests. */
  getBaseline(modality: PhysicalModality): { mean: number; variance: number; samples: number } | null {
    const b = this.baselines.get(modality);
    return b ? { mean: b.mean, variance: b.variance, samples: b.samples } : null;
  }
}

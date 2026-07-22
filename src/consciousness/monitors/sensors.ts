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
import { PhysicalReading, PhysicalModality, SensorSource } from '../sensors/types';
import { SensorIngressGuard, SensorArousalFilter, IngressStats } from '../sensors/guard';

// ─── Seeded PRNG (reproducible replay) ──────────────────────────────

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Used so that
 * `SENSORS_SEED=<int>` yields a deterministic synthetic stream (required for
 * the training stack and reproducible tests). Unseeded sources fall back to
 * Math.random.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Read SENSORS_SEED from env; undefined/blank/non-numeric → no seed. */
export function readSensorSeed(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.SENSORS_SEED;
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

// ─── Per-modality synthetic generators ──────────────────────────────
//
// Each generator returns exactly `dim` numeric values in the modality's
// physical units (documented inline). A generator NEVER emits a string —
// the PhysicalReading type makes that unrepresentable — so these plug into
// the already-verified ingress → arousal → fusion pipeline unchanged.

interface GenContext {
  rng: () => number;
  now: number;
  seq: number;
  /** Additive transient for this window (0 when none pending). */
  spike: number;
}

export interface SyntheticSourceConfig {
  modality: PhysicalModality;
  dim: number;
  generate: (ctx: GenContext) => number[];
  /** Diverges distinct modalities under a single base seed. */
  seedOffset: number;
}

/** Box-Muller-free approximate standard normal from a uniform rng. */
function gauss(rng: () => number): number {
  return (rng() + rng() + rng() + rng() + rng() + rng() - 3) / Math.sqrt(0.5);
}

/** synthetic (dim 8) — dimensionless pseudo-diurnal scaffold waveform. */
const SYNTHETIC_GEN: SyntheticSourceConfig = {
  modality: 'synthetic', dim: 8, seedOffset: 0,
  generate: ({ rng, now, spike }) => {
    const phase = (now % 86_400_000) / 86_400_000;
    const base = 1 + 0.5 * Math.sin(2 * Math.PI * phase);
    return Array.from({ length: 8 }, (_, i) =>
      base * (1 + 0.05 * Math.sin(i)) + spike + (rng() - 0.5) * 0.02);
  },
};

/** em_spectrum (dim 1024) — normalized PSD bins (real driver: dBm/bin). */
const EM_GEN: SyntheticSourceConfig = {
  modality: 'em_spectrum', dim: 1024, seedOffset: 101,
  generate: ({ rng, spike }) => {
    const carriers = [96, 288, 511, 733, 900]; // fixed "stations" across the band
    return Array.from({ length: 1024 }, (_, i) => {
      const floor = 0.05 + Math.abs(gauss(rng)) * 0.01; // noise floor
      let peak = 0;
      for (const c of carriers) peak += 0.9 * Math.exp(-((i - c) ** 2) / 8);
      return floor + peak + spike * Math.exp(-((i - 512) ** 2) / 4000);
    });
  },
};

/** gravitational (dim 2049) — whitened strain FFT magnitude (~unit variance). */
const GW_GEN: SyntheticSourceConfig = {
  modality: 'gravitational', dim: 2049, seedOffset: 202,
  generate: ({ rng, spike }) =>
    // Whitened detector noise is ~N(0,1); a real event is a chirp bump.
    Array.from({ length: 2049 }, (_, i) =>
      gauss(rng) + spike * Math.exp(-((i - 350) ** 2) / 2000)),
};

/** field_magnetic (dim 3) — [Bx,By,Bz] microtesla, Earth field ~47 µT. */
const MAG_GEN: SyntheticSourceConfig = {
  modality: 'field_magnetic', dim: 3, seedOffset: 303,
  generate: ({ rng, spike }) => {
    const earth = [22.5, 4.2, -41.3]; // plausible local field vector, |B| ≈ 47 µT
    return earth.map(axis => axis + gauss(rng) * 0.3 + spike);
  },
};

/** field_imu (dim 6) — [ax,ay,az] m/s² (gravity on z) + [gx,gy,gz] rad/s. */
const IMU_GEN: SyntheticSourceConfig = {
  modality: 'field_imu', dim: 6, seedOffset: 404,
  generate: ({ rng, spike }) => [
    gauss(rng) * 0.02 + spike,        // ax — horizontal, seismic-sensitive
    gauss(rng) * 0.02 + spike,        // ay
    9.81 + gauss(rng) * 0.02,         // az — resting gravity
    gauss(rng) * 0.001,               // gx — gyro at rest
    gauss(rng) * 0.001,               // gy
    gauss(rng) * 0.001,               // gz
  ],
};

/** field_environment (dim 5) — [tempC, hPa, RH%, lux, dB]. */
const ENV_GEN: SyntheticSourceConfig = {
  modality: 'field_environment', dim: 5, seedOffset: 505,
  generate: ({ rng, now, spike }) => {
    const phase = (now % 86_400_000) / 86_400_000;
    return [
      22 + 3 * Math.sin(2 * Math.PI * phase) + gauss(rng) * 0.1,  // tempC — diurnal
      1013 + gauss(rng) * 0.5,                                     // hPa
      45 + gauss(rng) * 1,                                         // RH%
      Math.max(0, 300 * Math.sin(Math.PI * phase) + gauss(rng) * 5), // lux — daylight
      40 + Math.abs(gauss(rng)) * 2 + spike,                       // dB
    ];
  },
};

/** quantum_rng (dim 256) — entropy pool, normalized [0,1). Spike-immune. */
const QRNG_GEN: SyntheticSourceConfig = {
  modality: 'quantum_rng', dim: 256, seedOffset: 606,
  generate: ({ rng }) => Array.from({ length: 256 }, () => rng()),
};

const GENERATORS: Record<PhysicalModality, SyntheticSourceConfig> = {
  synthetic: SYNTHETIC_GEN,
  em_spectrum: EM_GEN,
  gravitational: GW_GEN,
  field_magnetic: MAG_GEN,
  field_imu: IMU_GEN,
  field_environment: ENV_GEN,
  quantum_rng: QRNG_GEN,
};

/**
 * Synthetic physical source for scaffold validation. Emits a physically
 * plausible, correctly-dimensioned window per modality with occasional
 * injected transients so the filter's behavior is observable end-to-end
 * without hardware. Deterministic when a seed is supplied.
 */
export class SyntheticSensorSource implements SensorSource {
  readonly modality: PhysicalModality;
  readonly dim: number;
  private readonly config: SyntheticSourceConfig;
  private readonly rng: () => number;
  private seq = 0;
  /** When set, the next read() emits a spike of this amplitude. */
  private pendingSpike: number | null = null;

  constructor(config: SyntheticSourceConfig = SYNTHETIC_GEN, seed?: number) {
    this.config = config;
    this.modality = config.modality;
    this.dim = config.dim;
    this.rng = seed === undefined
      ? Math.random
      : mulberry32((seed + config.seedOffset) >>> 0);
  }

  injectTransient(amplitude: number = 10): void {
    this.pendingSpike = amplitude;
  }

  read(now: number = Date.now()): PhysicalReading {
    this.seq++;
    const spike = this.pendingSpike ?? 0;
    this.pendingSpike = null;
    const values = this.config.generate({ rng: this.rng, now, seq: this.seq, spike });
    return { modality: this.modality, values, timestamp: now, seq: this.seq };
  }
}

/** Build a synthetic source for one modality (seeded when seed is given). */
export function createSyntheticSource(
  modality: PhysicalModality,
  seed?: number,
): SyntheticSensorSource {
  return new SyntheticSensorSource(GENERATORS[modality], seed);
}

/**
 * Resolve the synthetic sources to activate from the environment.
 * SENSORS_SYNTHETIC_MODALITIES is a comma list (default: 'synthetic');
 * unknown modalities are skipped with a warning. SENSORS_SEED makes the
 * whole set deterministic.
 */
export function buildSyntheticSources(env: NodeJS.ProcessEnv = process.env): SensorSource[] {
  const seed = readSensorSeed(env);
  const requested = (env.SENSORS_SYNTHETIC_MODALITIES ?? 'synthetic')
    .split(',').map(s => s.trim()).filter(Boolean);
  const sources: SensorSource[] = [];
  for (const m of requested) {
    if (m in GENERATORS) {
      sources.push(createSyntheticSource(m as PhysicalModality, seed));
    } else {
      console.warn(`  [sensors] ignoring unknown synthetic modality '${m}'`);
    }
  }
  return sources;
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
      // Modalities via SENSORS_SYNTHETIC_MODALITIES (default 'synthetic'),
      // determinism via SENSORS_SEED.
      this.sources = buildSyntheticSources();
      this.enabled = this.sources.length > 0;
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

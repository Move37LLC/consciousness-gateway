/**
 * Physical Sensor Types — Phase 3 safety scaffold (P3.0a)
 *
 * THE STRUCTURAL GUARANTEE (Gateway wiring-review ruling, 2026-07-22):
 *
 *   "The separation guarantee will live in the type system, not policy.
 *    A demodulated radio signal or LIGO strain packet will never be able
 *    to become an intention."
 *
 * Enforced in three layers:
 *
 *   1. TYPE    — PhysicalReading carries ONLY numbers. There are no
 *                free-form string fields anywhere on the physical percept
 *                path; the modality is a closed union. Text cannot exist
 *                here, so text can never be parsed here.
 *   2. INGRESS — SensorIngressGuard re-builds every reading from scratch
 *                (never spreads input), dropping anything non-numeric,
 *                mis-dimensioned, stale, or over-rate.
 *   3. CHOKE   — IntentionEngine.reactToPercept() short-circuits on
 *                sensation percepts before any dispatch. Sensation reaches
 *                fusion (arousal, experience space) but never the decision
 *                kernel D. Sensation only.
 */

import { SpatialPercept } from '../types';

// ─── Modalities (closed union — extending it is a reviewed code change) ─

export type PhysicalModality =
  | 'em_spectrum'         // P3.1 RTL-SDR power spectral density
  | 'gravitational'       // P3.2 GWOSC strain replay
  | 'field_magnetic'      // P3.3 magnetometer
  | 'field_imu'           // P3.3 accelerometer/gyro (seismic)
  | 'field_environment'   // P3.3 temp / pressure / humidity / light
  | 'quantum_rng'         // P4.1 vacuum-fluctuation randomness
  | 'synthetic';          // P3.0a synthetic source for scaffold validation

/**
 * A single window of physical measurement. Numbers only — by construction
 * there is nowhere in this type for an instruction to live.
 */
export interface PhysicalReading {
  modality: PhysicalModality;
  /** Numeric samples for this window (e.g. PSD bins, strain FFT, field axes). */
  values: number[];
  /** Unix epoch ms when the window was captured. */
  timestamp: number;
  /** Monotonic sequence number from the capture source. */
  seq: number;
}

/** Per-modality ingress contract: dimensionality, rate ceiling, staleness. */
export interface SensorChannelSpec {
  modality: PhysicalModality;
  /** Exact expected length of PhysicalReading.values. */
  dim: number;
  /** Maximum readings admitted per rolling minute (rate-limit ceiling). */
  maxPerMinute: number;
  /** Readings older than this are dropped as stale (ms). */
  maxAgeMs: number;
}

/**
 * Default channel contracts — RATIFIED (Gateway sensor-contract ruling,
 * 2026-07-22). Spectral instruments keep their natural binned shape;
 * field instruments carry honest low-dim physical vectors:
 *
 *   em_spectrum        1024   PSD bins            normalized power (real driver: dBm/bin)
 *   gravitational      2049   strain FFT bins     whitened strain (LIGO rfft, 1s @ 4096 Hz)
 *   field_magnetic        3   [Bx, By, Bz]        microtesla (Earth field ~25–65 µT)
 *   field_imu             6   [ax,ay,az,gx,gy,gz] accel m/s² (~9.81 rest) + gyro rad/s
 *   field_environment     5   [tempC,hPa,RH%,lux,dB]
 *   quantum_rng         256   entropy pool        normalized [0,1)
 *   synthetic             8   scaffold waveform   dimensionless
 *
 * Rates assume one window per poll (~4/min) with headroom.
 */
export const DEFAULT_CHANNEL_SPECS: SensorChannelSpec[] = [
  { modality: 'em_spectrum',       dim: 1024, maxPerMinute: 8,  maxAgeMs: 120_000 },
  { modality: 'gravitational',     dim: 2049, maxPerMinute: 8,  maxAgeMs: 600_000 },
  { modality: 'field_magnetic',    dim: 3,    maxPerMinute: 12, maxAgeMs: 120_000 },
  { modality: 'field_imu',         dim: 6,    maxPerMinute: 12, maxAgeMs: 120_000 },
  { modality: 'field_environment', dim: 5,    maxPerMinute: 12, maxAgeMs: 300_000 },
  { modality: 'quantum_rng',       dim: 256,  maxPerMinute: 8,  maxAgeMs: 600_000 },
  { modality: 'synthetic',         dim: 8,    maxPerMinute: 12, maxAgeMs: 120_000 },
];

// ─── Sensation percepts (the fusion-facing shape) ───────────────────

export const SENSATION_SOURCE = 'sensors';

/**
 * Payload of a sensation percept. Every value is a number or the literal
 * brand — declared as a type alias (not interface) so it stays assignable
 * to SpatialPercept's Record<string, unknown> data field.
 */
export type SensationData = {
  /** Brand checked by the intention-engine choke point. */
  sensation: true;
  modality: PhysicalModality;
  /** RMS energy of the reading window. */
  energy: number;
  /** Adaptive baseline energy this window was compared against. */
  baselineEnergy: number;
  /** z-score of energy vs the adaptive baseline. */
  anomalyZ: number;
  /** Fraction of recent windows that were anomalous (0-1). */
  persistence: number;
  /** Source sequence number. */
  seq: number;
};

/**
 * The choke-point predicate, checked FIRST in IntentionEngine.reactToPercept.
 * Deliberately an OR (defense in depth): anything carrying EITHER the sensor
 * source label OR the sensation brand is treated as sensation and choked.
 * A percept can only avoid the choke by carrying neither marker — and the
 * sensor pipeline stamps both on everything it emits.
 */
export function isSensation(p: SpatialPercept): boolean {
  return p.source === SENSATION_SOURCE
    || (p.data as { sensation?: unknown }).sensation === true;
}

// ─── Sensor sources (synthetic now, hardware drivers later) ─────────

/**
 * A source of physical readings. P3.0a ships SyntheticSensorSource;
 * P3.1+ hardware drivers (RTL-SDR, GWOSC, Sense HAT) implement the same
 * contract, so they plug into an already-verified-safe pipeline.
 */
export interface SensorSource {
  readonly modality: PhysicalModality;
  readonly dim: number;
  /** Produce the next window, or null when no new window is available. */
  read(now?: number): PhysicalReading | null;
}

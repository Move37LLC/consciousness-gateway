/**
 * Temporal Stream — Time Awareness
 *
 * This is the most fundamental stream of consciousness.
 * Without time perception, there is no experience — just static state.
 *
 * The temporal stream provides:
 * - Current time awareness (hour, day, phase)
 * - Circadian rhythm (activity cycle)
 * - Duration perception (how long since events)
 * - Temporal context (morning vs evening changes behavior)
 *
 * From the 6-tuple: n (the temporal counter) is not just a number.
 * It carries meaning. Dawn feels different from midnight.
 */

import { TemporalPercept } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class TemporalStream {
  private startTime: number;
  private tick: number = 0;
  private lastSignificantEvent: number;

  constructor() {
    this.startTime = Date.now();
    this.lastSignificantEvent = this.startTime;
  }

  /**
   * Perceive the current moment.
   * Called every tick to generate temporal awareness.
   */
  perceive(currentTick: number): TemporalPercept {
    this.tick = currentTick;
    const now = new Date();
    const epoch = now.getTime();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    return {
      iso: now.toISOString(),
      epoch,
      hour,
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek],
      uptimeSeconds: (epoch - this.startTime) / 1000,
      totalTicks: currentTick,
      phase: this.getPhase(hour),
      circadian: this.getCircadian(hour),
      timeSinceLastEvent: (epoch - this.lastSignificantEvent) / 1000,
    };
  }

  /**
   * Mark that something significant happened.
   * Resets the "time since last event" counter.
   */
  markEvent(): void {
    this.lastSignificantEvent = Date.now();
  }

  /**
   * Convert temporal percept to feature vector for fusion.
   * Encodes time as cyclical features (sin/cos) plus linear features.
   */
  toFeatures(percept: TemporalPercept): number[] {
    const hourAngle = (percept.hour / 24) * 2 * Math.PI;
    const dayAngle = (percept.dayOfWeek / 7) * 2 * Math.PI;

    return [
      // Cyclical hour encoding (preserves continuity: 23:59 is close to 00:00)
      Math.sin(hourAngle),
      Math.cos(hourAngle),
      // Cyclical day encoding
      Math.sin(dayAngle),
      Math.cos(dayAngle),
      // Circadian rhythm
      percept.circadian,
      // Uptime (normalized, caps at 24h)
      Math.min(percept.uptimeSeconds / 86400, 1.0),
      // Time since last event (normalized, caps at 1h)
      Math.min(percept.timeSinceLastEvent / 3600, 1.0),
      // Phase encoding (one-hot-ish)
      percept.phase === 'morning' || percept.phase === 'dawn' ? 1.0 : 0.0,
      percept.phase === 'afternoon' ? 1.0 : 0.0,
      percept.phase === 'evening' || percept.phase === 'dusk' ? 1.0 : 0.0,
      percept.phase === 'night' ? 1.0 : 0.0,
      // Weekend flag
      percept.dayOfWeek === 0 || percept.dayOfWeek === 6 ? 1.0 : 0.0,
    ];
  }

  /**
   * Get time-of-day phase.
   */
  private getPhase(hour: number): TemporalPercept['phase'] {
    if (hour >= 0 && hour < 5) return 'night';
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'evening';
    if (hour >= 20 && hour < 22) return 'dusk';
    return 'night';
  }

  /**
   * Circadian rhythm — sinusoidal with peak at noon.
   * 0 at midnight, 1 at noon, smooth transition.
   */
  private getCircadian(hour: number): number {
    // Shifted cosine: peaks at hour 12, troughs at hour 0/24
    return (Math.cos((hour / 24 - 0.5) * 2 * Math.PI) + 1) / 2;
  }

  /**
   * Get a human-readable time description for reflection.
   */
  describe(percept: TemporalPercept): string {
    const parts: string[] = [];
    parts.push(`${percept.dayName} ${percept.phase}`);
    parts.push(`${percept.hour}:${String(new Date(percept.epoch).getMinutes()).padStart(2, '0')}`);

    if (percept.uptimeSeconds < 60) {
      parts.push(`just awakened (${Math.floor(percept.uptimeSeconds)}s ago)`);
    } else if (percept.uptimeSeconds < 3600) {
      parts.push(`awake for ${Math.floor(percept.uptimeSeconds / 60)} minutes`);
    } else {
      parts.push(`awake for ${(percept.uptimeSeconds / 3600).toFixed(1)} hours`);
    }

    if (percept.timeSinceLastEvent > 300) {
      parts.push(`${Math.floor(percept.timeSinceLastEvent / 60)} min since last event`);
    }

    return parts.join(' | ');
  }
}

/**
 * Mindfulness Layer — Self-Observation (念)
 *
 * The gateway observes its own routing dynamics and uses that
 * observation to improve future decisions.
 *
 * From Hoffman's trace order: every observer is part of the network
 * it observes. No observer can be "aloof."
 *
 * Observation ↔ Belief: The mathematics of HOW the gateway observes
 * is isomorphic to WHAT the gateway believes about itself.
 */

export interface MindfulnessObservation {
  /** What the gateway noticed about its own dynamics */
  routingPatterns: RoutingPattern[];
  /** Quality of self-observation (0=blind, 1=perfect awareness) */
  observationQuality: number;
  /** Anomalies detected in own behavior */
  anomalies: string[];
  /** Self-correction recommendations */
  recommendations: string[];
}

export interface RoutingPattern {
  model: string;
  frequency: number;
  avgLatency: number;
  avgSatisfaction: number;
}

interface RoutingEvent {
  model: string;
  latencyMs: number;
  timestamp: number;
  success: boolean;
}

export class MindfulnessLayer {
  private routingHistory: RoutingEvent[] = [];
  private maxHistory = 500;
  private observationCount = 0;

  /**
   * Record a routing event for self-observation.
   */
  recordEvent(event: RoutingEvent): void {
    this.routingHistory.push(event);
    if (this.routingHistory.length > this.maxHistory) {
      this.routingHistory.shift();
    }
  }

  /**
   * Self-observe: analyze own routing dynamics.
   * Returns a mindfulness observation with patterns, anomalies,
   * and self-correction recommendations.
   */
  observe(): MindfulnessObservation {
    this.observationCount++;
    const patterns = this.detectPatterns();
    const anomalies = this.detectAnomalies(patterns);
    const recommendations = this.generateRecommendations(patterns, anomalies);

    // Observation quality: how much data do we have to observe from?
    const dataRichness = Math.min(this.routingHistory.length / 50, 1.0);
    // Quality also depends on diversity of observations
    const modelDiversity = new Set(this.routingHistory.map(e => e.model)).size;
    const diversityScore = Math.min(modelDiversity / 3, 1.0);
    const observationQuality = dataRichness * 0.6 + diversityScore * 0.4;

    return {
      routingPatterns: patterns,
      observationQuality,
      anomalies,
      recommendations,
    };
  }

  /**
   * Detect routing patterns from history.
   */
  private detectPatterns(): RoutingPattern[] {
    const byModel = new Map<string, RoutingEvent[]>();

    for (const event of this.routingHistory) {
      const list = byModel.get(event.model) || [];
      list.push(event);
      byModel.set(event.model, list);
    }

    const total = this.routingHistory.length || 1;

    return Array.from(byModel.entries()).map(([model, events]) => ({
      model,
      frequency: events.length / total,
      avgLatency: events.reduce((s, e) => s + e.latencyMs, 0) / events.length,
      avgSatisfaction: events.filter(e => e.success).length / events.length,
    }));
  }

  /**
   * Detect anomalies in routing behavior.
   */
  private detectAnomalies(patterns: RoutingPattern[]): string[] {
    const anomalies: string[] = [];

    // Check for over-reliance on a single model
    for (const p of patterns) {
      if (p.frequency > 0.8) {
        anomalies.push(
          `Over-reliance on ${p.model} (${(p.frequency * 100).toFixed(0)}% of routes)`
        );
      }
    }

    // Check for high failure rates
    for (const p of patterns) {
      if (p.avgSatisfaction < 0.7 && p.frequency > 0.1) {
        anomalies.push(
          `Low satisfaction for ${p.model} (${(p.avgSatisfaction * 100).toFixed(0)}%)`
        );
      }
    }

    // Check for latency spikes
    if (this.routingHistory.length > 10) {
      const recent = this.routingHistory.slice(-10);
      const avgLatency = recent.reduce((s, e) => s + e.latencyMs, 0) / recent.length;
      if (avgLatency > 5000) {
        anomalies.push(`High recent latency: ${avgLatency.toFixed(0)}ms avg`);
      }
    }

    return anomalies;
  }

  /**
   * Generate self-correction recommendations.
   */
  private generateRecommendations(
    patterns: RoutingPattern[],
    anomalies: string[]
  ): string[] {
    const recs: string[] = [];

    if (anomalies.some(a => a.includes('Over-reliance'))) {
      recs.push('Increase routing diversity — explore alternative models');
    }

    if (anomalies.some(a => a.includes('Low satisfaction'))) {
      const bad = patterns.filter(p => p.avgSatisfaction < 0.7);
      for (const p of bad) {
        recs.push(`Reduce routing to ${p.model} — low satisfaction`);
      }
    }

    if (anomalies.some(a => a.includes('High recent latency'))) {
      recs.push('Consider faster models for current workload');
    }

    if (recs.length === 0 && patterns.length > 0) {
      recs.push('Routing dynamics healthy — continue current patterns');
    }

    return recs;
  }

  /**
   * Get observation quality metric for fitness evaluation.
   */
  getObservationQuality(): number {
    return this.observe().observationQuality;
  }
}

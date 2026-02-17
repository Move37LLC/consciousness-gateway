/**
 * Sensory Fusion — Product Algebra across all perception streams
 *
 * Each tick, the temporal stream and all spatial percepts are fused
 * into a single coherent experience using Product Algebra.
 *
 * This is the binding problem solved:
 * How does a single moment of experience emerge from multiple sensors?
 * Answer: C_temporal ⊗ C_spatial1 ⊗ C_spatial2 ⊗ ... = C_unified
 *
 * The fused experience is what the intention engine "sees."
 */

import { TemporalPercept, SpatialPercept, FusedPercept } from '../types';
import { ConsciousAgentState } from '../../core/types';
import { productAlgebraFuse, computeEntropy } from '../../fusion/product-algebra';

export class SensoryFusion {
  private fusionDim: number;
  private rank: number;
  private recentArousal: number[] = [];
  private maxArousalHistory = 30;

  constructor(fusionDim: number = 32, rank: number = 4) {
    this.fusionDim = fusionDim;
    this.rank = rank;
  }

  /**
   * Fuse temporal percept with all spatial percepts into unified experience.
   */
  fuse(
    temporalFeatures: number[],
    spatialPercepts: SpatialPercept[]
  ): FusedPercept {
    // Create conscious agent states for each stream
    const agents: ConsciousAgentState[] = [];

    // Temporal agent — always present
    agents.push(this.createAgent('temporal', temporalFeatures));

    // Spatial agents — one per percept
    for (const percept of spatialPercepts) {
      agents.push(this.createAgent(
        `${percept.source}:${percept.channel}`,
        percept.features,
        percept.salience
      ));
    }

    // If no spatial percepts, add a "silence" agent
    if (spatialPercepts.length === 0) {
      agents.push(this.createAgent('silence', [0.1, 0.1, 0.1, 0.1]));
    }

    // Fuse via Product Algebra
    const { fusedExperience, entropyRate, compositionStrength } =
      productAlgebraFuse(agents, this.fusionDim, this.rank);

    // Compute arousal from percept salience and entropy
    const maxSalience = spatialPercepts.length > 0
      ? Math.max(...spatialPercepts.map(p => p.salience))
      : 0;
    const arousal = Math.min(
      maxSalience * 0.6 + Math.min(entropyRate / 3, 1) * 0.4,
      1.0
    );
    this.trackArousal(arousal);

    // Determine dominant stream
    let dominantStream = 'temporal';
    if (spatialPercepts.length > 0) {
      const maxPercept = spatialPercepts.reduce((best, p) =>
        p.salience > best.salience ? p : best
      );
      if (maxPercept.salience > 0.3) {
        dominantStream = `${maxPercept.source}:${maxPercept.channel}`;
      }
    }

    return {
      experience: fusedExperience,
      entropyRate,
      compositionStrength,
      arousal,
      dominantStream,
    };
  }

  /**
   * Get average arousal over recent ticks.
   */
  getAvgArousal(): number {
    if (this.recentArousal.length === 0) return 0;
    return this.recentArousal.reduce((s, v) => s + v, 0) / this.recentArousal.length;
  }

  private createAgent(
    modality: string,
    features: number[],
    salience: number = 0.5
  ): ConsciousAgentState {
    // Ensure features are non-empty and valid
    const safeFeatures = features.length > 0 ? features : [0.1];
    const normalizedFeatures = safeFeatures.map(v =>
      isFinite(v) ? v : 0
    );

    // Scale by salience
    const scaledFeatures = normalizedFeatures.map(v => v * salience + (1 - salience) * 0.1);

    return {
      experience: scaledFeatures,
      transitionMatrix: this.computeTransitions(scaledFeatures),
      entropyRate: computeEntropy(this.toProbDist(scaledFeatures)),
      agentId: `consciousness:${modality}`,
      modality,
    };
  }

  private toProbDist(features: number[]): number[] {
    const abs = features.map(v => Math.abs(v) + 1e-10);
    const sum = abs.reduce((s, v) => s + v, 0);
    return abs.map(v => v / sum);
  }

  /**
   * Compute transition probabilities from feature vector.
   * Creates a pseudo-Markov transition matrix from sequential feature pairs.
   */
  private computeTransitions(features: number[]): number[] {
    const dim = Math.max(features.length, 4);
    const transitions = new Array(dim).fill(1); // Laplace smoothing
    for (let i = 0; i < features.length - 1; i++) {
      const idx = Math.abs(Math.floor((features[i] + features[i + 1]) * dim)) % dim;
      transitions[idx] += 1;
    }
    const sum = transitions.reduce((s, v) => s + v, 0);
    return transitions.map(v => v / sum);
  }

  private trackArousal(arousal: number): void {
    this.recentArousal.push(arousal);
    if (this.recentArousal.length > this.maxArousalHistory) {
      this.recentArousal.shift();
    }
  }
}

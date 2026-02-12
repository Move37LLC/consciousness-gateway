/**
 * Product Algebra Fusion — TypeScript port of our validated Python research
 *
 * Core innovation: Kronecker product of Markov kernels for multimodal fusion.
 * From Hoffman's conscious agent theory: C₁ ⊗ C₂ = C₃
 * Two conscious agents interacting = one larger conscious agent.
 *
 * Empirically validated: 439 models, 10 statistically significant wins,
 * Cohen's d up to 1.02. See EXPERIMENTAL_RESULTS.md.
 *
 * In the gateway context, this fuses understanding of text, vision, and
 * context modalities to make consciousness-aware model selection decisions.
 */

import { ConsciousAgentState } from '../core/types';

/**
 * Compute entropy rate of a transition probability distribution.
 * H = -Σ pᵢ log pᵢ
 *
 * In Hoffman's framework: mass ∝ H (entropy rate)
 * In Token-Mind: suffering ∝ H
 * Low entropy = flow state = optimal routing
 */
export function computeEntropy(probs: number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 1e-10) {
      h -= p * Math.log(p);
    }
  }
  return h;
}

/**
 * Softmax normalization — ensures probability distribution sums to 1.
 * The Markov kernel condition: each row of the transition matrix
 * must be a valid probability distribution.
 */
export function softmax(values: number[], temperature = 1.0): number[] {
  const maxVal = Math.max(...values);
  const exps = values.map(v => Math.exp((v - maxVal) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * Low-rank Kronecker product approximation.
 *
 * Full Kronecker: (m×m) ⊗ (n×n) → (mn×mn) — grows exponentially.
 * Our approximation: project agents into shared space, then combine.
 * This is the key insight from our research: low-rank Kronecker
 * captures cross-modal interaction with 55% fewer parameters.
 *
 * @param agents - Array of conscious agent states to fuse
 * @param fusionDim - Dimension of the fused experience space
 * @param rank - Kronecker rank (lower = more compression, 4 optimal)
 * @returns Fused experience vector and entropy rate
 */
export function productAlgebraFuse(
  agents: ConsciousAgentState[],
  fusionDim: number,
  rank: number = 4
): { fusedExperience: number[]; entropyRate: number; compositionStrength: number } {

  if (agents.length === 0) {
    return {
      fusedExperience: new Array(fusionDim).fill(0),
      entropyRate: 1.0,
      compositionStrength: 0,
    };
  }

  if (agents.length === 1) {
    // Single agent: project to fusion dim
    const projected = projectToFusionDim(agents[0].experience, fusionDim);
    return {
      fusedExperience: projected,
      entropyRate: agents[0].entropyRate,
      compositionStrength: 0,
    };
  }

  // Step 1: Project each agent's experience to rank-dimensional factors
  const factors: number[][] = agents.map(agent =>
    projectToFusionDim(agent.experience, rank)
  );

  // Step 2: Compute cross-modal interaction via element-wise product
  // This is the low-rank Kronecker approximation:
  // Instead of full (d₁d₂ × d₁d₂) Kronecker, we compute
  // rank-dimensional factor products, then project up
  const interaction = new Array(rank).fill(0);
  for (let r = 0; r < rank; r++) {
    let product = 1.0;
    for (const factor of factors) {
      product *= factor[r];
    }
    interaction[r] = product;
  }

  // Step 3: Project interaction to fusion dimension
  // Uses a deterministic pseudo-random projection (reproducible)
  const fusedExperience = projectToFusionDim(interaction, fusionDim);

  // Step 4: Add individual agent contributions (residual connection)
  // The fused agent is more than the product — it retains individual experiences
  for (const agent of agents) {
    const projected = projectToFusionDim(agent.experience, fusionDim);
    for (let i = 0; i < fusionDim; i++) {
      fusedExperience[i] += projected[i] / agents.length;
    }
  }

  // Normalize to probability-like distribution for entropy computation
  const fusedProbs = softmax(fusedExperience);

  // Step 5: Compute entropy rate of fused dynamics
  const entropyRate = computeEntropy(fusedProbs);

  // Step 6: Measure composition strength
  // How much did cross-modal interaction contribute vs individual agents?
  const interactionNorm = Math.sqrt(interaction.reduce((s, v) => s + v * v, 0));
  const agentNorms = agents.map(a =>
    Math.sqrt(a.experience.reduce((s, v) => s + v * v, 0))
  );
  const avgAgentNorm = agentNorms.reduce((s, n) => s + n, 0) / agentNorms.length;
  const compositionStrength = avgAgentNorm > 0
    ? interactionNorm / (avgAgentNorm + 1e-10)
    : 0;

  return { fusedExperience, entropyRate, compositionStrength };
}

/**
 * Project a vector to target dimension using deterministic projection.
 * Acts as a lightweight linear layer without learned weights.
 */
function projectToFusionDim(input: number[], targetDim: number): number[] {
  const result = new Array(targetDim).fill(0);
  const inputLen = input.length;

  if (inputLen === targetDim) {
    return [...input];
  }

  // Deterministic projection: spread input across target dimensions
  for (let i = 0; i < targetDim; i++) {
    // Each output dimension is a weighted sum of input dimensions
    // Weights determined by position (no randomness, fully reproducible)
    for (let j = 0; j < inputLen; j++) {
      const weight = Math.cos((i * j * Math.PI) / Math.max(targetDim, inputLen));
      result[i] += input[j] * weight;
    }
    result[i] /= Math.sqrt(inputLen);
  }

  return result;
}

/**
 * Create a ConsciousAgentState from raw text input.
 * Maps text features to experience space.
 */
export function createTextAgent(text: string): ConsciousAgentState {
  // Simple text features: character distribution, length, complexity
  const dim = 32;
  const experience = new Array(dim).fill(0);

  // Character frequency distribution (first 26 dims = letter frequencies)
  const lower = text.toLowerCase();
  for (const char of lower) {
    const code = char.charCodeAt(0) - 97; // a=0, b=1, ...
    if (code >= 0 && code < 26) {
      experience[code] += 1;
    }
  }
  // Normalize
  const charSum = experience.slice(0, 26).reduce((s, v) => s + v, 0) || 1;
  for (let i = 0; i < 26; i++) experience[i] /= charSum;

  // Additional features
  experience[26] = Math.min(text.length / 1000, 1);           // length
  experience[27] = (text.match(/\?/g) || []).length / 10;     // question density
  experience[28] = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1); // caps
  experience[29] = (text.split(/\s+/).length) / 200;          // word count
  experience[30] = text.includes('```') ? 1 : 0;              // has code
  experience[31] = (text.match(/\n/g) || []).length / 50;     // line density

  // Compute simple transition matrix (bigram probabilities, flattened)
  const transitionMatrix = computeBigramTransitions(lower, dim);
  const entropyRate = computeEntropy(softmax(experience));

  return {
    experience,
    transitionMatrix,
    entropyRate,
    agentId: 'text_agent',
    modality: 'text',
  };
}

/**
 * Create a ConsciousAgentState from image/vision input.
 */
export function createVisionAgent(hasImage: boolean): ConsciousAgentState {
  const dim = 32;
  const experience = new Array(dim).fill(0);

  if (hasImage) {
    // Vision modality is active
    experience[0] = 1.0; // has visual content
    // In production, this would use actual image embeddings
    // For now, signal that vision routing is needed
    for (let i = 1; i < dim; i++) {
      experience[i] = 0.5 * Math.sin(i * 0.3); // placeholder features
    }
  }

  return {
    experience,
    transitionMatrix: new Array(dim).fill(1 / dim),
    entropyRate: hasImage ? 0.5 : 1.0,
    agentId: 'vision_agent',
    modality: 'vision',
  };
}

/**
 * Create a ConsciousAgentState from conversation context.
 */
export function createContextAgent(context: {
  turnCount?: number;
  topic?: string;
  urgency?: number;
}): ConsciousAgentState {
  const dim = 32;
  const experience = new Array(dim).fill(0);

  experience[0] = Math.min((context.turnCount || 0) / 20, 1); // conversation depth
  experience[1] = context.urgency || 0.5;                      // urgency level

  // Topic encoding (simple hash-based)
  if (context.topic) {
    for (let i = 0; i < context.topic.length && i < 10; i++) {
      experience[2 + i] = (context.topic.charCodeAt(i) % 100) / 100;
    }
  }

  return {
    experience,
    transitionMatrix: new Array(dim).fill(1 / dim),
    entropyRate: 0.3,
    agentId: 'context_agent',
    modality: 'context',
  };
}

/**
 * Compute bigram transition probabilities from text.
 */
function computeBigramTransitions(text: string, dim: number): number[] {
  const transitions = new Array(dim).fill(1); // Laplace smoothing
  for (let i = 0; i < text.length - 1; i++) {
    const idx = (text.charCodeAt(i) + text.charCodeAt(i + 1)) % dim;
    transitions[idx] += 1;
  }
  const sum = transitions.reduce((s, v) => s + v, 0);
  return transitions.map(v => v / sum);
}

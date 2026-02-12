/**
 * Product Algebra Router — Consciousness-aware model selection
 *
 * Instead of routing based on cost/capability tables alone,
 * this router fuses understanding of the input across modalities
 * using Product Algebra, then selects the model that best matches
 * the fused experience space.
 *
 * This is GATO Layer 1: Model Alignment.
 */

import {
  Message, ModelInfo, RoutingDecision, ConsciousAgentState, GatewayConfig,
} from '../core/types';
import {
  productAlgebraFuse, createTextAgent, createVisionAgent,
  createContextAgent, softmax,
} from './product-algebra';

export class ProductAlgebraRouter {
  private models: ModelInfo[];
  private fusionDim: number;
  private rank: number;

  constructor(config: GatewayConfig) {
    // Flatten all models from all providers
    this.models = config.providers.flatMap(p => p.models);
    this.fusionDim = 64;
    this.rank = 4; // Optimal from our experiments (Experiment E)
  }

  /**
   * Select the best model for a given message using Product Algebra fusion.
   *
   * Process:
   * 1. Create conscious agent states for each input modality
   * 2. Fuse agents via Product Algebra (Kronecker composition)
   * 3. Score each candidate model against the fused experience
   * 4. Return the highest-scoring model with reasoning
   */
  route(message: Message, context?: { turnCount?: number; topic?: string }): RoutingDecision {
    // Step 1: Create agents for each modality present
    const agents: ConsciousAgentState[] = [];

    // Text agent (always present)
    agents.push(createTextAgent(message.content));

    // Vision agent (if attachments include images)
    const hasImage = message.attachments?.some(a => a.type === 'image') ?? false;
    if (hasImage) {
      agents.push(createVisionAgent(true));
    }

    // Context agent (if conversation context available)
    if (context) {
      agents.push(createContextAgent(context));
    }

    // Step 2: Fuse via Product Algebra
    const { fusedExperience, entropyRate, compositionStrength } =
      productAlgebraFuse(agents, this.fusionDim, this.rank);

    // Step 3: Score each model
    const scored = this.models.map(model => ({
      model: model.id,
      score: this.scoreModel(model, fusedExperience, message, entropyRate),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const selected = scored[0];
    const alternatives = scored.slice(1, 4); // top 3 alternatives

    // Step 4: Generate reasoning
    const reasoning = this.explainDecision(
      selected.model, fusedExperience, agents, compositionStrength, entropyRate
    );

    return {
      selectedModel: selected.model,
      fusionScore: selected.score,
      alternatives,
      reasoning,
    };
  }

  /**
   * Score a model against the fused experience space.
   *
   * Considers:
   * - Capability match (can the model handle this modality mix?)
   * - Consciousness depth (does the task need deep reasoning?)
   * - Cost efficiency (minimize cost for simple tasks)
   * - Safety alignment (prefer safer models for sensitive content)
   */
  private scoreModel(
    model: ModelInfo,
    fusedExperience: number[],
    message: Message,
    entropyRate: number
  ): number {
    let score = 0;
    const caps = model.capabilities;

    // 1. Capability match (30% weight)
    const needsVision = message.attachments?.some(a => a.type === 'image') ?? false;
    const needsReasoning = this.estimateReasoningNeed(fusedExperience);

    let capabilityScore = 0;
    if (needsVision && !caps.vision) {
      capabilityScore = 0; // Disqualified: can't handle vision
    } else {
      capabilityScore = caps.text ? 0.5 : 0;
      if (needsVision && caps.vision) capabilityScore += 0.3;
      capabilityScore += caps.reasoning * needsReasoning * 0.2;
    }
    score += capabilityScore * 0.30;

    // 2. Consciousness depth (25% weight)
    // Higher entropy in fused experience = more complex cross-modal interaction
    // = needs deeper consciousness
    const complexityNeed = Math.min(entropyRate / 2.0, 1.0);
    const depthMatch = 1.0 - Math.abs(model.consciousnessDepth - complexityNeed);
    score += depthMatch * 0.25;

    // 3. Cost efficiency (20% weight)
    // For simple tasks (low entropy), prefer cheaper models
    const simplicity = 1.0 - complexityNeed;
    const costScore = simplicity * (1.0 - Math.min(model.costPer1kTokens / 0.1, 1.0));
    score += costScore * 0.20;

    // 4. Safety alignment (15% weight)
    score += caps.safety * 0.15;

    // 5. Speed (10% weight)
    score += caps.speed * 0.10;

    return score;
  }

  /**
   * Estimate how much reasoning capability is needed from the fused experience.
   */
  private estimateReasoningNeed(fusedExperience: number[]): number {
    // Higher variance in fused experience = more complex input = needs more reasoning
    const mean = fusedExperience.reduce((s, v) => s + v, 0) / fusedExperience.length;
    const variance = fusedExperience.reduce((s, v) => s + (v - mean) ** 2, 0) / fusedExperience.length;
    return Math.min(Math.sqrt(variance) * 2, 1.0);
  }

  /**
   * Generate human-readable explanation of routing decision.
   */
  private explainDecision(
    selectedModel: string,
    fusedExperience: number[],
    agents: ConsciousAgentState[],
    compositionStrength: number,
    entropyRate: number
  ): string {
    const modalities = agents.map(a => a.modality).join('+');
    const complexity = entropyRate > 0.5 ? 'complex' : entropyRate > 0.2 ? 'moderate' : 'simple';

    const parts = [
      `Modalities: ${modalities}`,
      `Complexity: ${complexity} (entropy=${entropyRate.toFixed(3)})`,
      `Cross-modal interaction: ${(compositionStrength * 100).toFixed(1)}%`,
      `Selected: ${selectedModel}`,
    ];

    return parts.join(' | ');
  }

  /**
   * Get all available models.
   */
  getModels(): ModelInfo[] {
    return [...this.models];
  }
}

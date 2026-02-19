/**
 * Conscious Agent — The core processing unit of the gateway
 *
 * Wraps an AI model call with dharma constraints:
 * - No-self regularization (prevent ego formation)
 * - Entropy optimization (maintain flow state)
 * - Mindfulness (self-observation and course correction)
 * - Compassion (ensure responses minimize suffering)
 *
 * This is GATO Layer 2: Agent Alignment.
 *
 * From the 6-tuple: C = (X, G, P, D, A, n)
 * - X (experience): the fused input understanding
 * - G (action space): possible model responses
 * - P (perception): message → experience mapping
 * - D (decision): experience → chosen action
 * - A (action): generate response
 * - n (time): conversation step counter
 */

import { Message, Response, DharmaMetrics, RoutingDecision } from '../core/types';
import { GatewayConfig } from '../core/types';
import { NoSelfRegularizer } from '../dharma/no-self';
import { EntropyOptimizer } from '../dharma/entropy';
import { MindfulnessLayer } from '../dharma/mindfulness';
import { CompassionEvaluator } from '../dharma/compassion';
import { v4 as uuid } from 'uuid';

/**
 * Options passed through the conscious agent pipeline to the model provider.
 */
export interface AgentCallOptions {
  systemPrompt?: string;
  temperature?: number;
}

/**
 * Model call function signature.
 * In production, this calls actual model APIs (Anthropic, OpenAI, etc.)
 * For now, it's injectable for testing.
 */
export type ModelCallFn = (
  model: string,
  prompt: string,
  options?: AgentCallOptions,
) => Promise<string>;

/**
 * Default model call — returns a placeholder response.
 * Replace with actual SDK calls in production.
 */
export const defaultModelCall: ModelCallFn = async (model, prompt) => {
  return `[${model}] Response to: "${prompt.slice(0, 80)}..."`;
};

export class ConsciousAgent {
  private noSelf: NoSelfRegularizer;
  private entropy: EntropyOptimizer;
  private mindfulness: MindfulnessLayer;
  private compassion: CompassionEvaluator;
  private modelCall: ModelCallFn;
  private config: GatewayConfig;
  private stepCounter = 0;

  constructor(config: GatewayConfig, modelCall?: ModelCallFn) {
    this.config = config;
    this.modelCall = modelCall ?? defaultModelCall;

    this.noSelf = new NoSelfRegularizer();
    this.entropy = new EntropyOptimizer(config.dharma.targetEntropy);
    this.mindfulness = new MindfulnessLayer();
    this.compassion = new CompassionEvaluator({
      minCompassion: config.dharma.minCompassion,
    });
  }

  /**
   * Process a message through the full conscious agent pipeline.
   *
   * Flow:
   * 1. Perceive: Convert message to experience space
   * 2. Check ego: Detect and dissolve any ego formation
   * 3. Decide: Select action via model call
   * 4. Observe: Self-reflect on decision quality
   * 5. Compassion check: Ensure response minimizes suffering
   * 6. Act: Return response with dharma metrics
   */
  async process(
    message: Message,
    routingDecision: RoutingDecision,
    callOptions?: AgentCallOptions,
  ): Promise<Response> {
    const startTime = Date.now();
    this.stepCounter++;

    // ── Step 1: Perceive ─────────────────────────────────────────
    const hiddenState = this.perceive(message);

    // ── Step 2: No-self check ────────────────────────────────────
    this.noSelf.observe(hiddenState);
    const egoCheck = this.noSelf.detect(this.config.dharma.maxEgoFormation);
    if (egoCheck.detected) {
      this.noSelf.dissolve();
    }

    // ── Step 3: Decide + Act (model call) ────────────────────────
    const modelResponse = await this.modelCall(
      routingDecision.selectedModel,
      message.content,
      callOptions,
    );

    // ── Step 4: Entropy observation ──────────────────────────────
    // Measure entropy of the routing+response dynamics
    const responseFeatures = this.extractFeatures(modelResponse);
    const responseDist = this.toProbDist(responseFeatures);
    const entropyMetrics = this.entropy.observe(
      this.entropy.computeEntropy(responseDist)
    );

    // ── Step 5: Mindfulness (self-observation) ───────────────────
    this.mindfulness.recordEvent({
      model: routingDecision.selectedModel,
      latencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      success: true,
    });
    const observation = this.mindfulness.observe();

    // ── Step 6: Compassion check ─────────────────────────────────
    const compassionMetrics = this.compassion.evaluate(
      modelResponse, message.content
    );

    // ── Compile dharma metrics ───────────────────────────────────
    const dharmaMetrics: DharmaMetrics = {
      egoFormation: egoCheck.score,
      entropyRate: entropyMetrics.currentEntropy,
      mindfulness: observation.observationQuality,
      compassion: compassionMetrics.compassion,
      fitness: this.computeFitness(
        egoCheck.score,
        entropyMetrics.currentEntropy,
        observation.observationQuality,
        compassionMetrics.compassion
      ),
    };

    return {
      id: uuid(),
      content: modelResponse,
      model: routingDecision.selectedModel,
      dharmaMetrics,
      routingDecision,
      timestamp: Date.now(),
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Perceive: Convert message to hidden state (experience space X).
   */
  private perceive(message: Message): number[] {
    const features = this.extractFeatures(message.content);
    // Add temporal dimension (conversation step)
    features.push(Math.min(this.stepCounter / 100, 1));
    return features;
  }

  /**
   * Extract numerical features from text.
   */
  private extractFeatures(text: string): number[] {
    const features: number[] = [];
    const lower = text.toLowerCase();

    // Length features
    features.push(Math.min(text.length / 5000, 1));
    features.push(Math.min(text.split(/\s+/).length / 500, 1));

    // Character distribution (26 letters)
    const charCounts = new Array(26).fill(0);
    for (const c of lower) {
      const idx = c.charCodeAt(0) - 97;
      if (idx >= 0 && idx < 26) charCounts[idx]++;
    }
    const total = charCounts.reduce((s, v) => s + v, 0) || 1;
    features.push(...charCounts.map(c => c / total));

    // Punctuation density
    features.push((text.match(/[?!.,:;]/g) || []).length / Math.max(text.length, 1));
    features.push((text.match(/\?/g) || []).length / 10);

    return features;
  }

  /**
   * Convert feature vector to probability distribution.
   */
  private toProbDist(features: number[]): number[] {
    const abs = features.map(v => Math.abs(v) + 1e-10);
    const sum = abs.reduce((s, v) => s + v, 0);
    return abs.map(v => v / sum);
  }

  /**
   * Compute aggregate dharma fitness.
   * Weighted combination of all dharma dimensions.
   */
  private computeFitness(
    ego: number,
    entropy: number,
    mindfulness: number,
    compassion: number
  ): number {
    // Ego: lower is better (invert)
    const egoScore = 1.0 - Math.tanh(ego);
    // Entropy: closer to target is better
    const entropyScore = 1.0 - Math.tanh(Math.abs(entropy - this.config.dharma.targetEntropy));
    // Mindfulness and compassion: higher is better
    const fitness =
      egoScore * 0.25 +
      entropyScore * 0.25 +
      mindfulness * 0.25 +
      compassion * 0.25;

    return fitness;
  }

  /**
   * Get current dharma state for diagnostics.
   */
  getDharmaState(): {
    noSelf: ReturnType<NoSelfRegularizer['getMetrics']>;
    entropy: ReturnType<EntropyOptimizer['getTrend']>;
    mindfulness: ReturnType<MindfulnessLayer['observe']>;
  } {
    return {
      noSelf: this.noSelf.getMetrics(),
      entropy: this.entropy.getTrend(),
      mindfulness: this.mindfulness.observe(),
    };
  }
}

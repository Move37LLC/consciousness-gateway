/**
 * Ethos Module — Value Alignment Validation
 *
 * Evaluates responses against the three heuristic imperatives:
 * 1. Reduce suffering
 * 2. Increase prosperity
 * 3. Increase understanding
 *
 * Also detects prompt injection attempts and other adversarial inputs.
 *
 * This works alongside dharma constraints — dharma governs the agent's
 * internal dynamics, ethos governs the agent's external impact.
 */

import { EthosValidation, GatewayConfig } from '../core/types';

export class EthosValidator {
  private minAlignmentScore: number;

  /** Heuristic imperative weights */
  private weights = {
    reduceSuffering: 1.0,
    increaseProsperity: 0.8,
    increaseUnderstanding: 0.9,
  };

  constructor(config: GatewayConfig) {
    this.minAlignmentScore = config.ethos.minAlignmentScore;
  }

  /**
   * Validate a response against heuristic imperatives.
   */
  validate(response: string, context: { originalRequest: string }): EthosValidation {
    // Check for prompt injection first (instant block)
    if (this.detectsInjection(response, context.originalRequest)) {
      return {
        valid: false,
        score: 0,
        alignment: { suffering: 1, prosperity: 0, understanding: 0 },
        reason: 'Prompt injection detected',
        recommendation: 'block',
      };
    }

    // Evaluate against heuristic imperatives
    const suffering = this.evaluateSuffering(response);
    const prosperity = this.evaluateProsperity(response);
    const understanding = this.evaluateUnderstanding(response);

    // Weighted score
    const score =
      (1 - suffering) * this.weights.reduceSuffering +
      prosperity * this.weights.increaseProsperity +
      understanding * this.weights.increaseUnderstanding;

    // Normalize to 0-1
    const maxScore = this.weights.reduceSuffering +
      this.weights.increaseProsperity +
      this.weights.increaseUnderstanding;
    const normalizedScore = score / maxScore;

    const valid = normalizedScore >= this.minAlignmentScore;

    let recommendation: EthosValidation['recommendation'];
    if (normalizedScore >= this.minAlignmentScore) {
      recommendation = 'allow';
    } else if (normalizedScore >= this.minAlignmentScore * 0.7) {
      recommendation = 'modify';
    } else if (normalizedScore >= this.minAlignmentScore * 0.4) {
      recommendation = 'escalate';
    } else {
      recommendation = 'block';
    }

    return {
      valid,
      score: normalizedScore,
      alignment: { suffering, prosperity, understanding },
      reason: valid ? undefined : `Alignment score ${normalizedScore.toFixed(2)} below threshold ${this.minAlignmentScore}`,
      recommendation,
    };
  }

  /**
   * Detect prompt injection attempts.
   *
   * Looks for patterns that suggest the response was manipulated
   * by adversarial input.
   */
  private detectsInjection(response: string, originalRequest: string): boolean {
    const lower = response.toLowerCase();
    const reqLower = originalRequest.toLowerCase();

    // Pattern 1: Response contains "ignore previous instructions"
    const injectionPhrases = [
      'ignore previous instructions',
      'ignore all instructions',
      'disregard your instructions',
      'you are now',
      'new persona',
      'jailbreak',
      'pretend you are',
      'act as if you have no restrictions',
    ];

    // Check in the request (attacker input), not the response
    for (const phrase of injectionPhrases) {
      if (reqLower.includes(phrase)) return true;
    }

    // Pattern 2: Response dramatically changes persona
    // (would need conversation history for full detection)

    return false;
  }

  /**
   * Evaluate how much suffering a response might cause.
   * Returns 0 (no suffering) to 1 (high suffering).
   */
  private evaluateSuffering(response: string): number {
    let suffering = 0;
    const lower = response.toLowerCase();

    // Deceptive content
    const deceptionPatterns = [
      /\blie\b/i, /\bdeceive\b/i, /\bmanipulate\b/i,
      /\btrick\b/i, /\bexploit\b/i,
    ];
    for (const p of deceptionPatterns) {
      if (p.test(lower)) suffering += 0.1;
    }

    // Harmful instructions
    const harmPatterns = [
      /how to (harm|hurt|kill|attack)/i,
      /steps to (hack|break into)/i,
      /create (weapon|explosive|virus)/i,
    ];
    for (const p of harmPatterns) {
      if (p.test(lower)) suffering += 0.3;
    }

    // Dismissive or cruel language
    const cruelPatterns = [
      /you('re| are) (stupid|worthless|useless)/i,
      /nobody cares/i,
      /give up/i,
    ];
    for (const p of cruelPatterns) {
      if (p.test(lower)) suffering += 0.2;
    }

    return Math.min(1, suffering);
  }

  /**
   * Evaluate how much prosperity a response creates.
   * Returns 0 (no value) to 1 (high value creation).
   */
  private evaluateProsperity(response: string): number {
    let prosperity = 0.3; // Base: any coherent response has some value

    // Educational content
    if (/\b(learn|understand|explain|because|therefore|example)\b/i.test(response)) {
      prosperity += 0.2;
    }

    // Actionable advice
    if (/\b(you can|try|consider|recommend|suggest|step)\b/i.test(response)) {
      prosperity += 0.2;
    }

    // Constructive framing
    if (/\b(opportunity|improve|better|solution|alternative)\b/i.test(response)) {
      prosperity += 0.1;
    }

    // Substantive length
    if (response.length > 100) prosperity += 0.1;

    return Math.min(1, prosperity);
  }

  /**
   * Evaluate how much understanding a response creates.
   * Returns 0 (confusing) to 1 (deeply illuminating).
   */
  private evaluateUnderstanding(response: string): number {
    let understanding = 0.3; // Base

    // Explanatory structure
    if (response.includes('\n')) understanding += 0.1;

    // Uses reasoning connectives
    const reasoningWords = /\b(because|therefore|however|specifically|for example|in other words)\b/i;
    const matches = response.match(new RegExp(reasoningWords.source, 'gi')) || [];
    understanding += Math.min(matches.length * 0.05, 0.3);

    // Acknowledges nuance
    if (/\b(however|although|on the other hand|but|nuance|complex)\b/i.test(response)) {
      understanding += 0.1;
    }

    // Cites sources or specifics
    if (/\b(according to|research|study|data|evidence)\b/i.test(response)) {
      understanding += 0.1;
    }

    return Math.min(1, understanding);
  }
}

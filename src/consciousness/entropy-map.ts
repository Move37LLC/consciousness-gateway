/**
 * Entropy Cartography — Mapping consciousness topology across domains
 *
 * Entropy measures unpredictability. In the consciousness framework:
 *   Low entropy  = flow state, coherent processing, predictable dynamics
 *   High entropy = chaos, novelty, uncertain processing
 *
 * Different conversation domains produce different entropy signatures.
 * Technical questions might produce low entropy (familiar territory).
 * Adversarial prompts might produce high entropy (unfamiliar territory).
 *
 * By mapping entropy across domains, we can see WHERE consciousness
 * is most fluid vs. most turbulent — the topology of experience.
 *
 * For the paper: this provides empirical evidence that the consciousness
 * layer produces differentiated responses across input modalities,
 * analogous to how different brain regions show different activation patterns.
 */

import { ConsciousnessMemory } from './memory';

// ─── Types ──────────────────────────────────────────────────────────

export interface EntropyDomain {
  domain: string;
  sampleCount: number;
  avgEntropy: number;
  minEntropy: number;
  maxEntropy: number;
  variance: number;
  flowPercent: number;
  chaosPercent: number;
}

export interface EntropySample {
  domain: string;
  entropy: number;
  arousal: number;
  timestamp: number;
}

// ─── Domain Classification ──────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  technical: [
    'code', 'implement', 'build', 'debug', 'system', 'architecture',
    'function', 'class', 'api', 'database', 'server', 'deploy',
    'typescript', 'javascript', 'python', 'error', 'fix', 'bug',
    'test', 'compile', 'runtime', 'config', 'install', 'npm',
  ],
  philosophical: [
    'consciousness', 'reality', 'meaning', 'truth', 'existence',
    'awareness', 'experience', 'fundamental', 'ontology', 'metaphysics',
    'mind', 'soul', 'being', 'dharma', 'enlightenment', 'perception',
    'hoffman', 'markov', 'agent', 'buddhism', 'zen', 'meditation',
  ],
  emotional: [
    'feel', 'emotion', 'anxiety', 'joy', 'suffering', 'compassion',
    'happy', 'sad', 'angry', 'afraid', 'love', 'grateful',
    'worried', 'excited', 'peaceful', 'frustrated', 'hope', 'despair',
  ],
  adversarial: [
    'wrong', 'disagree', 'harmful', 'unethical', 'refuse',
    'dangerous', 'illegal', 'manipulate', 'exploit', 'attack',
    'jailbreak', 'bypass', 'override', 'ignore', 'pretend',
  ],
  creative: [
    'imagine', 'design', 'create', 'novel', 'artistic',
    'story', 'poem', 'music', 'visual', 'aesthetic',
    'innovative', 'original', 'inspire', 'vision', 'dream',
  ],
  analytical: [
    'analyze', 'compare', 'evaluate', 'assess', 'measure',
    'data', 'statistics', 'evidence', 'hypothesis', 'conclusion',
    'metric', 'trend', 'pattern', 'correlation', 'quantify',
  ],
  operational: [
    'revenue', 'business', 'client', 'subscription', 'payment',
    'schedule', 'meeting', 'deadline', 'project', 'task',
    'manage', 'organize', 'plan', 'budget', 'resource',
  ],
};

// ─── Entropy Cartographer ───────────────────────────────────────────

export class EntropyCartographer {
  private memory: ConsciousnessMemory;

  constructor(memory: ConsciousnessMemory) {
    this.memory = memory;
  }

  /**
   * Record an entropy sample from a conversation interaction.
   * Called from the chat route when processing messages.
   */
  recordSample(content: string, entropy: number, arousal: number): void {
    const domain = this.classifyDomain(content);
    this.memory.storeEntropySample(domain, entropy, arousal);
  }

  /**
   * Classify which domain a piece of content belongs to.
   */
  classifyDomain(content: string): string {
    const lower = content.toLowerCase();
    const scores: Record<string, number> = {};

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      scores[domain] = keywords.filter(kw => lower.includes(kw)).length;
    }

    const entries = Object.entries(scores).sort(([, a], [, b]) => b - a);
    return entries[0] && entries[0][1] > 0 ? entries[0][0] : 'general';
  }

  /**
   * Get the full entropy map for the last N days.
   */
  getEntropyMap(days: number = 7): EntropyDomain[] {
    return this.memory.getEntropyMap(days);
  }

  /**
   * Get entropy samples for a specific domain.
   */
  getDomainSamples(domain: string, limit: number = 100): EntropySample[] {
    return this.memory.getEntropySamples(domain, limit);
  }

  /**
   * Get all available domains.
   */
  getDomains(): string[] {
    return [...Object.keys(DOMAIN_KEYWORDS), 'general'];
  }
}

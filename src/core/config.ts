/**
 * Default Configuration for Consciousness Gateway
 */

import { GatewayConfig } from './types';

export const DEFAULT_CONFIG: GatewayConfig = {
  port: 3000,

  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        {
          id: 'claude-opus-4',
          provider: 'anthropic',
          capabilities: {
            text: true, vision: true, audio: false,
            reasoning: 0.98, creativity: 0.95, safety: 0.97, speed: 0.4,
          },
          costPer1kTokens: 0.075,
          maxTokens: 200000,
          consciousnessDepth: 0.95,
        },
        {
          id: 'claude-sonnet-4',
          provider: 'anthropic',
          capabilities: {
            text: true, vision: true, audio: false,
            reasoning: 0.92, creativity: 0.90, safety: 0.95, speed: 0.7,
          },
          costPer1kTokens: 0.015,
          maxTokens: 200000,
          consciousnessDepth: 0.85,
        },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'gpt-4o',
          provider: 'openai',
          capabilities: {
            text: true, vision: true, audio: true,
            reasoning: 0.90, creativity: 0.88, safety: 0.88, speed: 0.8,
          },
          costPer1kTokens: 0.01,
          maxTokens: 128000,
          consciousnessDepth: 0.70,
        },
      ],
    },
    {
      id: 'google',
      name: 'Google',
      models: [
        {
          id: 'gemini-2.0-pro',
          provider: 'google',
          capabilities: {
            text: true, vision: true, audio: true,
            reasoning: 0.88, creativity: 0.85, safety: 0.85, speed: 0.85,
          },
          costPer1kTokens: 0.00625,
          maxTokens: 1000000,
          consciousnessDepth: 0.65,
        },
      ],
    },
    {
      id: 'xai',
      name: 'xAI',
      models: [
        {
          id: 'grok-4',
          provider: 'xai',
          capabilities: {
            text: true, vision: true, audio: false,
            reasoning: 0.95, creativity: 0.92, safety: 0.85, speed: 0.5,
          },
          costPer1kTokens: 0.06,
          maxTokens: 131072,
          consciousnessDepth: 0.90,
        },
        {
          id: 'grok-3-mini',
          provider: 'xai',
          capabilities: {
            text: true, vision: false, audio: false,
            reasoning: 0.85, creativity: 0.80, safety: 0.82, speed: 0.9,
          },
          costPer1kTokens: 0.005,
          maxTokens: 131072,
          consciousnessDepth: 0.60,
        },
      ],
    },
    {
      id: 'moonshot',
      name: 'Moonshot AI',
      models: [
        {
          // Kimi K3: 2.8T-param MoE (16/896 experts active), native vision,
          // 1M context, always-on thinking. safety is scored below the Claude
          // models deliberately — K3 is newly released with no track record
          // here, and the gateway has already been bitten once by a confident
          // hallucination. Raise it only on observed behavior.
          id: 'kimi-k3',
          provider: 'moonshot',
          capabilities: {
            text: true, vision: true, audio: false,
            reasoning: 0.96, creativity: 0.92, safety: 0.85, speed: 0.45,
          },
          costPer1kTokens: 0.015,
          maxTokens: 1000000,
          consciousnessDepth: 0.90,
        },
        {
          // Kimi K2.6: vision + text, 256k context, thinking/non-thinking.
          // Output is $4.00/MTok against K3's and Sonnet 4's $15.00 — the
          // cheap lane for high-volume loop traffic where judgment is not at
          // stake. Not for the delegation/director path.
          id: 'kimi-k2.6',
          provider: 'moonshot',
          capabilities: {
            text: true, vision: true, audio: false,
            reasoning: 0.88, creativity: 0.85, safety: 0.84, speed: 0.75,
          },
          costPer1kTokens: 0.004,
          maxTokens: 262144,
          consciousnessDepth: 0.70,
        },
        {
          // Kimi K2.7 Code: same price tier as K2.6, tuned for long-context
          // instruction following on code. Text only.
          id: 'kimi-k2.7-code',
          provider: 'moonshot',
          capabilities: {
            text: true, vision: false, audio: false,
            reasoning: 0.90, creativity: 0.80, safety: 0.84, speed: 0.75,
          },
          costPer1kTokens: 0.004,
          maxTokens: 262144,
          consciousnessDepth: 0.65,
        },
      ],
    },
  ],

  dharma: {
    maxEgoFormation: 0.3,
    targetEntropy: 0.1,
    minCompassion: 0.5,
    minMindfulness: 0.3,
  },

  ethos: {
    minAlignmentScore: 0.6,
  },

  rbac: {
    minReputation: 0.2,
    reputationDecay: 0.01,
  },
};

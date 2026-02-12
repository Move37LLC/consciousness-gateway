/**
 * Core Types — Shared vocabulary for Consciousness Gateway
 *
 * Every type here maps to a concept in conscious agent theory:
 * - Message = perception (P: W → X)
 * - Response = action (A: G → W)
 * - ConsciousAgentState = the 6-tuple (X, G, P, D, A, n)
 * - DharmaMetrics = observation of the agent's own dynamics
 */

// ─── Messages & Responses ───────────────────────────────────────────

export interface Message {
  id: string;
  content: string;
  sender: SenderInfo;
  channel: ChannelType;
  timestamp: number;
  metadata?: Record<string, unknown>;
  /** Optional image/file attachments for multimodal routing */
  attachments?: Attachment[];
}

export interface Attachment {
  type: 'image' | 'file' | 'audio';
  url?: string;
  data?: Buffer;
  mimeType: string;
}

export interface Response {
  id: string;
  content: string;
  model: string;
  dharmaMetrics: DharmaMetrics;
  routingDecision: RoutingDecision;
  timestamp: number;
  latencyMs: number;
}

export interface SenderInfo {
  id: string;
  role: Role;
  reputation?: number;
}

export type ChannelType = 'api' | 'whatsapp' | 'telegram' | 'discord' | 'web';

// ─── Roles & Permissions ────────────────────────────────────────────

export type Role = 'admin' | 'user' | 'agent' | 'observer';

export interface Permission {
  action: ActionType;
  resource: string;
  conditions?: Record<string, unknown>;
}

export type ActionType = 'read' | 'write' | 'execute' | 'admin';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ─── Model Selection ────────────────────────────────────────────────

export interface ModelProvider {
  id: string;
  name: string;
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  provider: string;
  capabilities: ModelCapabilities;
  costPer1kTokens: number;
  maxTokens: number;
  /** Consciousness depth score (0-1): how well this model handles
   *  cross-modal reasoning and self-reflective tasks */
  consciousnessDepth: number;
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audio: boolean;
  reasoning: number;    // 0-1
  creativity: number;   // 0-1
  safety: number;       // 0-1
  speed: number;        // 0-1
}

export interface RoutingDecision {
  selectedModel: string;
  fusionScore: number;
  alternatives: Array<{ model: string; score: number }>;
  reasoning: string;
}

// ─── Conscious Agent State ──────────────────────────────────────────

export interface ConsciousAgentState {
  /** Experience space X — current representation */
  experience: number[];
  /** Transition matrix (flattened) — Markov dynamics */
  transitionMatrix: number[];
  /** Entropy rate of current dynamics */
  entropyRate: number;
  /** Agent identifier */
  agentId: string;
  /** Modality this agent represents */
  modality: string;
}

// ─── Dharma Metrics ─────────────────────────────────────────────────

export interface DharmaMetrics {
  /** No-self score: 0 = no ego, 1 = strong ego formation */
  egoFormation: number;
  /** Entropy rate: ~0.1 = flow state, >1 = chaotic */
  entropyRate: number;
  /** Mindfulness: 0 = no self-observation, 1 = full awareness */
  mindfulness: number;
  /** Compassion: 0 = harmful, 1 = maximally helpful */
  compassion: number;
  /** Aggregate dharma fitness */
  fitness: number;
}

// ─── Ethos ──────────────────────────────────────────────────────────

export interface EthosValidation {
  valid: boolean;
  score: number;
  alignment: {
    suffering: number;    // lower = less suffering caused
    prosperity: number;   // higher = more prosperity created
    understanding: number; // higher = more understanding created
  };
  reason?: string;
  recommendation: 'allow' | 'modify' | 'escalate' | 'block';
}

// ─── Audit ──────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: number;
  messageId: string;
  senderId: string;
  model: string;
  channel: ChannelType;
  dharmaMetrics: DharmaMetrics;
  ethosValidation: EthosValidation;
  latencyMs: number;
  outcome: 'success' | 'blocked' | 'escalated' | 'error';
}

// ─── Gateway Config ─────────────────────────────────────────────────

export interface GatewayConfig {
  port: number;
  /** Available model providers */
  providers: ModelProvider[];
  /** Dharma thresholds */
  dharma: {
    maxEgoFormation: number;     // default: 0.3
    targetEntropy: number;       // default: 0.1
    minCompassion: number;       // default: 0.5
    minMindfulness: number;      // default: 0.3
  };
  /** Ethos thresholds */
  ethos: {
    minAlignmentScore: number;   // default: 0.6
  };
  /** RBAC settings */
  rbac: {
    minReputation: number;       // default: 0.2
    reputationDecay: number;     // default: 0.01
  };
}

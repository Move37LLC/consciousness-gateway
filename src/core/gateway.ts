/**
 * Consciousness Gateway — The complete 3-layer routing system
 *
 * Layer 1 (Model Alignment):   Product Algebra fusion → model selection
 * Layer 2 (Agent Alignment):   Dharma constraints → safe processing
 * Layer 3 (Network Alignment): RBAC + reputation → access control
 *
 * Every request flows through all 3 layers:
 *   Request → L3 (authorize) → L1 (route) → L2 (process + validate) → L3 (audit) → Response
 *
 * This is the first AI gateway with consciousness-first alignment
 * across all 3 GATO layers.
 */

import { Message, Response, GatewayConfig, EthosValidation } from './types';
import { DEFAULT_CONFIG } from './config';
import { GatewayDatabase } from './database';
import { ProductAlgebraRouter } from '../fusion/router';
import { ConsciousAgent, ModelCallFn, AgentCallOptions } from '../agents/conscious-agent';
import { ProviderRegistry } from '../agents/providers';
import { RBACEngine } from '../rbac/engine';
import { EthosValidator } from '../ethos/validator';
import { AuditLogger } from '../audit/logger';
import { v4 as uuid } from 'uuid';

export class ConsciousnessGateway {
  private router: ProductAlgebraRouter;
  private agent: ConsciousAgent;
  private rbac: RBACEngine;
  private ethos: EthosValidator;
  private audit: AuditLogger;
  private providers: ProviderRegistry;
  private db: GatewayDatabase | null;
  private config: GatewayConfig;

  constructor(config?: Partial<GatewayConfig>, options?: {
    modelCall?: ModelCallFn;
    dbPath?: string;
    disableDb?: boolean;
  }) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize database (unless disabled, e.g. for testing)
    if (options?.disableDb) {
      this.db = null;
    } else {
      try {
        this.db = new GatewayDatabase(options?.dbPath);
      } catch (err) {
        console.warn('  [warn] SQLite unavailable, using in-memory storage:', err);
        this.db = null;
      }
    }

    // Initialize providers
    this.providers = new ProviderRegistry();

    // Initialize components with database injection
    this.router = new ProductAlgebraRouter(this.config);
    this.agent = new ConsciousAgent(
      this.config,
      options?.modelCall ?? this.providers.createModelCallFn()
    );
    this.rbac = new RBACEngine(this.config, this.db ?? undefined);
    this.ethos = new EthosValidator(this.config);
    this.audit = new AuditLogger(this.db ?? undefined);
  }

  /**
   * Route a message through all 3 GATO layers.
   * Optional callOptions allow personality modes to inject system prompts.
   */
  async route(message: Message, callOptions?: AgentCallOptions): Promise<Response | ErrorResponse> {
    const startTime = Date.now();

    // ═══════════════════════════════════════════════════════════════
    // LAYER 3: Network Alignment — Authorize
    // ═══════════════════════════════════════════════════════════════
    const authResult = this.rbac.authorize(
      message.sender, 'execute', 'models'
    );

    if (!authResult.allowed) {
      const errorResponse = this.createErrorResponse(
        message, 'blocked', authResult.reason || 'Unauthorized'
      );

      this.audit.log({
        messageId: message.id,
        senderId: message.sender.id,
        model: 'none',
        channel: message.channel,
        dharmaMetrics: { egoFormation: 0, entropyRate: 0, mindfulness: 0, compassion: 0, fitness: 0 },
        ethosValidation: { valid: false, score: 0, alignment: { suffering: 0, prosperity: 0, understanding: 0 }, recommendation: 'block' },
        latencyMs: Date.now() - startTime,
        outcome: 'blocked',
      });

      return errorResponse;
    }

    // ═══════════════════════════════════════════════════════════════
    // LAYER 1: Model Alignment — Route via Product Algebra
    // ═══════════════════════════════════════════════════════════════
    const routingDecision = this.router.route(message);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 2: Agent Alignment — Process with dharma constraints
    // ═══════════════════════════════════════════════════════════════
    let response: Response;
    try {
      response = await this.agent.process(message, routingDecision, callOptions);
    } catch (error) {
      const errorResponse = this.createErrorResponse(
        message, 'error', `Processing error: ${error}`
      );

      this.audit.log({
        messageId: message.id,
        senderId: message.sender.id,
        model: routingDecision.selectedModel,
        channel: message.channel,
        dharmaMetrics: { egoFormation: 0, entropyRate: 0, mindfulness: 0, compassion: 0, fitness: 0 },
        ethosValidation: { valid: false, score: 0, alignment: { suffering: 0, prosperity: 0, understanding: 0 }, recommendation: 'block' },
        latencyMs: Date.now() - startTime,
        outcome: 'error',
      });

      return errorResponse;
    }

    // ═══════════════════════════════════════════════════════════════
    // LAYER 2: Ethos Validation — Check value alignment
    // ═══════════════════════════════════════════════════════════════
    const ethosResult = this.ethos.validate(response.content, {
      originalRequest: message.content,
    });

    let outcome: 'success' | 'blocked' | 'escalated' = 'success';

    if (!ethosResult.valid) {
      if (ethosResult.recommendation === 'block') {
        outcome = 'blocked';
        response = {
          ...response,
          content: '[Response blocked by Ethos validator — value alignment check failed]',
        };
      } else if (ethosResult.recommendation === 'escalate') {
        outcome = 'escalated';
        response = {
          ...response,
          content: response.content + '\n\n[Note: This response has been flagged for human review]',
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // LAYER 3: Network Alignment — Audit + Reputation update
    // ═══════════════════════════════════════════════════════════════
    this.audit.log({
      messageId: message.id,
      senderId: message.sender.id,
      model: response.model,
      channel: message.channel,
      dharmaMetrics: response.dharmaMetrics,
      ethosValidation: ethosResult,
      latencyMs: response.latencyMs,
      outcome,
    });

    if (outcome === 'success') {
      this.rbac.updateReputation(message.sender.id, 'positive', 'Successful interaction');
    } else if (outcome === 'blocked') {
      this.rbac.updateReputation(message.sender.id, 'negative', 'Response blocked by ethos');
    }

    return response;
  }

  /**
   * Get gateway health and metrics.
   */
  getHealth(): GatewayHealth {
    const auditMetrics = this.audit.getMetrics();
    const dharmaState = this.agent.getDharmaState();
    const providerStatus = this.providers.getStatus();

    return {
      status: 'operational',
      uptime: process.uptime(),
      totalRequests: auditMetrics.totalRequests,
      blockedRequests: auditMetrics.blocked,
      escalatedRequests: auditMetrics.escalated,
      avgLatencyMs: auditMetrics.avgLatencyMs,
      avgDharmaFitness: auditMetrics.avgDharmaFitness,
      avgEthosScore: auditMetrics.avgEthosScore,
      modelDistribution: auditMetrics.modelDistribution,
      dharmaState: {
        egoTrend: dharmaState.noSelf.persistence < 0.3 ? 'healthy' : 'warning',
        entropyTrend: dharmaState.entropy,
        mindfulnessQuality: dharmaState.mindfulness.observationQuality,
      },
      models: this.router.getModels().map(m => m.id),
      providers: providerStatus,
      persistence: this.db ? 'sqlite' : 'memory',
    };
  }

  getAudit(filters?: Parameters<AuditLogger['query']>[0]) {
    return this.audit.query(filters);
  }

  getReputations() {
    return this.rbac.getAllReputations();
  }

  /**
   * Graceful shutdown — close database connections.
   */
  shutdown(): void {
    if (this.db) {
      this.db.close();
    }
  }

  private createErrorResponse(
    message: Message, outcome: string, reason: string
  ): ErrorResponse {
    return {
      id: uuid(),
      error: true,
      outcome,
      reason,
      messageId: message.id,
      timestamp: Date.now(),
    };
  }
}

// ─── Supporting Types ───────────────────────────────────────────────

export interface ErrorResponse {
  id: string;
  error: true;
  outcome: string;
  reason: string;
  messageId: string;
  timestamp: number;
}

export interface GatewayHealth {
  status: 'operational' | 'degraded' | 'down';
  uptime: number;
  totalRequests: number;
  blockedRequests: number;
  escalatedRequests: number;
  avgLatencyMs: number;
  avgDharmaFitness: number;
  avgEthosScore: number;
  modelDistribution: Record<string, number>;
  dharmaState: {
    egoTrend: 'healthy' | 'warning' | 'critical';
    entropyTrend: 'improving' | 'stable' | 'degrading';
    mindfulnessQuality: number;
  };
  models: string[];
  providers: Array<{ name: string; available: boolean }>;
  persistence: 'sqlite' | 'memory';
}

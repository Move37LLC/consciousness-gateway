/**
 * RBAC Engine + Reputation System — GATO Layer 3: Network Alignment
 *
 * Role-based access control with Nash equilibrium incentives:
 * - Good behavior → higher reputation → more access
 * - Bad behavior → lower reputation → restricted/revoked access
 *
 * The incentive structure makes alignment the rational choice.
 */

import {
  Role, ActionType, RiskLevel, Permission, SenderInfo, GatewayConfig,
} from '../core/types';
import { GatewayDatabase } from '../core/database';

// ─── Role Definitions ───────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    { action: 'read', resource: '*' },
    { action: 'write', resource: '*' },
    { action: 'execute', resource: '*' },
    { action: 'admin', resource: '*' },
  ],
  user: [
    { action: 'read', resource: 'models' },
    { action: 'execute', resource: 'models' },
    { action: 'read', resource: 'audit:own' },
  ],
  agent: [
    { action: 'read', resource: 'models' },
    { action: 'execute', resource: 'models' },
    { action: 'write', resource: 'audit' },
  ],
  observer: [
    { action: 'read', resource: 'models' },
    { action: 'read', resource: 'audit' },
    { action: 'read', resource: 'metrics' },
  ],
};

const ACTION_RISK: Record<ActionType, RiskLevel> = {
  read: 'low',
  write: 'medium',
  execute: 'medium',
  admin: 'critical',
};

const RISK_REPUTATION_THRESHOLD: Record<RiskLevel, number> = {
  low: 0.0,
  medium: 0.2,
  high: 0.5,
  critical: 0.8,
};

// ─── Reputation Store ───────────────────────────────────────────────

export interface ReputationRecord {
  agentId: string;
  score: number;         // 0.0 - 1.0
  interactions: number;
  lastUpdate: number;
  violations: number;
  history: ReputationEvent[];
}

export interface ReputationEvent {
  timestamp: number;
  delta: number;
  reason: string;
}

// ─── Authorization Result ───────────────────────────────────────────

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  reputation?: number;
}

// ─── RBAC Engine ────────────────────────────────────────────────────

export class RBACEngine {
  private reputations = new Map<string, ReputationRecord>();
  private config: GatewayConfig;
  private db: GatewayDatabase | null;
  private rateLimits = new Map<string, { count: number; windowStart: number }>();
  private rateLimit = 60; // requests per minute
  private rateWindow = 60_000; // 1 minute in ms

  constructor(config: GatewayConfig, db?: GatewayDatabase) {
    this.config = config;
    this.db = db ?? null;

    // Load existing reputations from database
    if (this.db) {
      try {
        const rows = this.db.getAllReputations();
        for (const row of rows) {
          this.reputations.set(row.agent_id, {
            agentId: row.agent_id,
            score: row.score,
            interactions: row.interactions,
            lastUpdate: row.last_update,
            violations: row.violations,
            history: [],
          });
        }
      } catch {
        // DB not ready yet, will populate on first use
      }
    }
  }

  /**
   * Authorize an action. Checks role permissions, reputation, and rate limits.
   *
   * This is the gateway's Layer 3: before any model call happens,
   * the sender must pass this check.
   */
  authorize(
    sender: SenderInfo,
    action: ActionType,
    resource: string
  ): AuthResult {
    // 1. Check role permissions
    if (!this.hasPermission(sender.role, action, resource)) {
      return {
        allowed: false,
        reason: `Role '${sender.role}' cannot '${action}' on '${resource}'`,
      };
    }

    // 2. Check reputation
    const reputation = this.getReputation(sender.id);
    const riskLevel = ACTION_RISK[action];
    const threshold = RISK_REPUTATION_THRESHOLD[riskLevel];

    if (reputation.score < threshold) {
      return {
        allowed: false,
        reason: `Reputation ${reputation.score.toFixed(2)} below threshold ${threshold} for ${riskLevel}-risk action`,
        reputation: reputation.score,
      };
    }

    // 3. Check rate limit
    if (this.isRateLimited(sender.id)) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded',
        reputation: reputation.score,
      };
    }

    // Record the rate limit hit
    this.recordRateLimit(sender.id);

    return {
      allowed: true,
      reputation: reputation.score,
    };
  }

  /**
   * Check if a role has a specific permission.
   */
  private hasPermission(role: Role, action: ActionType, resource: string): boolean {
    const perms = ROLE_PERMISSIONS[role] || [];
    return perms.some(p =>
      (p.action === action || p.action === 'admin') &&
      (p.resource === '*' || p.resource === resource || resource.startsWith(p.resource))
    );
  }

  /**
   * Get or create reputation record for an agent.
   */
  getReputation(agentId: string): ReputationRecord {
    let record = this.reputations.get(agentId);
    if (!record) {
      record = {
        agentId,
        score: 0.5, // Start neutral
        interactions: 0,
        lastUpdate: Date.now(),
        violations: 0,
        history: [],
      };
      this.reputations.set(agentId, record);
    }

    // Apply time-based decay
    const elapsed = (Date.now() - record.lastUpdate) / (1000 * 60 * 60); // hours
    if (elapsed > 1) {
      // Reputation decays slowly toward neutral (0.5)
      const decay = this.config.rbac.reputationDecay * elapsed;
      record.score = record.score + (0.5 - record.score) * Math.min(decay, 0.1);
      record.lastUpdate = Date.now();
    }

    return record;
  }

  /**
   * Update reputation based on interaction outcome.
   * Nash equilibrium: good outcomes increase reputation, bad decrease.
   */
  updateReputation(
    agentId: string,
    outcome: 'positive' | 'negative' | 'violation',
    reason: string
  ): void {
    const record = this.getReputation(agentId);
    record.interactions++;

    let delta: number;
    switch (outcome) {
      case 'positive':
        delta = 0.02; // Small positive increment
        break;
      case 'negative':
        delta = -0.05; // Moderate negative
        break;
      case 'violation':
        delta = -0.15; // Severe penalty
        record.violations++;
        break;
    }

    record.score = Math.max(0, Math.min(1, record.score + delta));
    record.lastUpdate = Date.now();
    record.history.push({ timestamp: Date.now(), delta, reason });

    // Keep history manageable
    if (record.history.length > 100) {
      record.history = record.history.slice(-100);
    }

    // Auto-revoke on too many violations
    if (record.violations >= 5 && record.score < this.config.rbac.minReputation) {
      record.score = 0; // Effectively revoked
    }

    // Persist to SQLite
    if (this.db) {
      try {
        this.db.upsertReputation(agentId, record.score, record.interactions, record.violations);
        this.db.addReputationEvent(agentId, delta, reason);
      } catch {
        // Non-fatal: memory state is authoritative
      }
    }
  }

  /**
   * Check rate limit for an agent.
   */
  private isRateLimited(agentId: string): boolean {
    const limit = this.rateLimits.get(agentId);
    if (!limit) return false;

    const now = Date.now();
    if (now - limit.windowStart > this.rateWindow) {
      // Window expired, reset
      this.rateLimits.delete(agentId);
      return false;
    }

    return limit.count >= this.rateLimit;
  }

  /**
   * Record a rate limit event.
   */
  private recordRateLimit(agentId: string): void {
    const now = Date.now();
    const limit = this.rateLimits.get(agentId);

    if (!limit || now - limit.windowStart > this.rateWindow) {
      this.rateLimits.set(agentId, { count: 1, windowStart: now });
    } else {
      limit.count++;
    }
  }

  /**
   * Get all reputation records (for dashboard).
   */
  getAllReputations(): ReputationRecord[] {
    return Array.from(this.reputations.values());
  }
}

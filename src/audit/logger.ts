/**
 * Audit Logger — Full consequence tracking with SQLite persistence
 *
 * Every routing decision, every dharma metric, every ethos validation
 * is recorded for transparency and accountability.
 *
 * Uses SQLite via GatewayDatabase for durable storage.
 * Falls back to in-memory if no database is provided.
 */

import { AuditEntry, DharmaMetrics, EthosValidation, ChannelType } from '../core/types';
import { GatewayDatabase } from '../core/database';
import { v4 as uuid } from 'uuid';

export class AuditLogger {
  private db: GatewayDatabase | null;
  private memoryFallback: AuditEntry[] = [];
  private maxMemory = 10000;

  constructor(db?: GatewayDatabase) {
    this.db = db ?? null;
  }

  /**
   * Log a gateway interaction. Persists to SQLite if available.
   */
  log(params: {
    messageId: string;
    senderId: string;
    model: string;
    channel: ChannelType;
    dharmaMetrics: DharmaMetrics;
    ethosValidation: EthosValidation;
    latencyMs: number;
    outcome: AuditEntry['outcome'];
  }): AuditEntry {
    const entry: AuditEntry = {
      id: uuid(),
      timestamp: Date.now(),
      ...params,
    };

    if (this.db) {
      try {
        this.db.insertAudit(entry);
      } catch (err) {
        // Fallback to memory on DB error
        console.error('Audit DB write failed, using memory:', err);
        this.pushMemory(entry);
      }
    } else {
      this.pushMemory(entry);
    }

    return entry;
  }

  /**
   * Query audit entries.
   */
  query(filters?: {
    senderId?: string;
    model?: string;
    outcome?: AuditEntry['outcome'];
    since?: number;
    limit?: number;
  }): AuditEntry[] {
    if (this.db) {
      try {
        return this.db.queryAudit(filters);
      } catch {
        // Fallback
      }
    }

    // In-memory query
    let results = [...this.memoryFallback];
    if (filters?.senderId) results = results.filter(e => e.senderId === filters.senderId);
    if (filters?.model) results = results.filter(e => e.model === filters.model);
    if (filters?.outcome) results = results.filter(e => e.outcome === filters.outcome);
    if (filters?.since) results = results.filter(e => e.timestamp >= filters.since!);
    results.sort((a, b) => b.timestamp - a.timestamp);
    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  /**
   * Get aggregate metrics.
   */
  getMetrics(since?: number): {
    totalRequests: number;
    blocked: number;
    escalated: number;
    avgLatencyMs: number;
    avgDharmaFitness: number;
    avgEthosScore: number;
    modelDistribution: Record<string, number>;
  } {
    if (this.db) {
      try {
        return this.db.getAuditMetrics(since);
      } catch {
        // Fallback
      }
    }

    // In-memory metrics
    const entries = since
      ? this.memoryFallback.filter(e => e.timestamp >= since)
      : this.memoryFallback;

    if (entries.length === 0) {
      return {
        totalRequests: 0, blocked: 0, escalated: 0,
        avgLatencyMs: 0, avgDharmaFitness: 0, avgEthosScore: 0,
        modelDistribution: {},
      };
    }

    const modelDist: Record<string, number> = {};
    let totalLatency = 0, totalFitness = 0, totalEthos = 0;
    let blocked = 0, escalated = 0;

    for (const e of entries) {
      modelDist[e.model] = (modelDist[e.model] || 0) + 1;
      totalLatency += e.latencyMs;
      totalFitness += e.dharmaMetrics.fitness;
      totalEthos += e.ethosValidation.score;
      if (e.outcome === 'blocked') blocked++;
      if (e.outcome === 'escalated') escalated++;
    }

    return {
      totalRequests: entries.length,
      blocked,
      escalated,
      avgLatencyMs: totalLatency / entries.length,
      avgDharmaFitness: totalFitness / entries.length,
      avgEthosScore: totalEthos / entries.length,
      modelDistribution: modelDist,
    };
  }

  private pushMemory(entry: AuditEntry): void {
    this.memoryFallback.push(entry);
    if (this.memoryFallback.length > this.maxMemory) {
      this.memoryFallback = this.memoryFallback.slice(-this.maxMemory);
    }
  }
}

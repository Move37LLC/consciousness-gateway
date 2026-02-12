/**
 * Database Layer — SQLite persistence for audit logs and reputation
 *
 * Uses better-sqlite3 for synchronous, fast, zero-config SQLite.
 * The database file lives at ./data/gateway.db by default.
 *
 * Schema:
 *   audit_log     — Every routing decision with dharma + ethos scores
 *   reputations   — Agent reputation records with history
 *   config        — Gateway configuration (future use)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { AuditEntry, DharmaMetrics, EthosValidation, ChannelType } from './types';

export class GatewayDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'gateway.db');

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
  }

  // ─── Schema Migration ───────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        model TEXT NOT NULL,
        channel TEXT NOT NULL,
        outcome TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,

        -- Dharma metrics (flattened)
        dharma_ego REAL NOT NULL DEFAULT 0,
        dharma_entropy REAL NOT NULL DEFAULT 0,
        dharma_mindfulness REAL NOT NULL DEFAULT 0,
        dharma_compassion REAL NOT NULL DEFAULT 0,
        dharma_fitness REAL NOT NULL DEFAULT 0,

        -- Ethos validation (flattened)
        ethos_valid INTEGER NOT NULL DEFAULT 1,
        ethos_score REAL NOT NULL DEFAULT 0,
        ethos_suffering REAL NOT NULL DEFAULT 0,
        ethos_prosperity REAL NOT NULL DEFAULT 0,
        ethos_understanding REAL NOT NULL DEFAULT 0,
        ethos_recommendation TEXT NOT NULL DEFAULT 'allow',

        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_sender ON audit_log(sender_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_model ON audit_log(model);
      CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_log(outcome);

      CREATE TABLE IF NOT EXISTS reputations (
        agent_id TEXT PRIMARY KEY,
        score REAL NOT NULL DEFAULT 0.5,
        interactions INTEGER NOT NULL DEFAULT 0,
        violations INTEGER NOT NULL DEFAULT 0,
        last_update INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reputation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        delta REAL NOT NULL,
        reason TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES reputations(agent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rep_events_agent ON reputation_events(agent_id);
    `);
  }

  // ─── Audit Log Operations ───────────────────────────────────────

  insertAudit(entry: AuditEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, message_id, sender_id, model, channel, outcome, latency_ms,
        dharma_ego, dharma_entropy, dharma_mindfulness, dharma_compassion, dharma_fitness,
        ethos_valid, ethos_score, ethos_suffering, ethos_prosperity, ethos_understanding,
        ethos_recommendation
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?
      )
    `);

    stmt.run(
      entry.id, entry.timestamp, entry.messageId, entry.senderId,
      entry.model, entry.channel, entry.outcome, entry.latencyMs,
      entry.dharmaMetrics.egoFormation, entry.dharmaMetrics.entropyRate,
      entry.dharmaMetrics.mindfulness, entry.dharmaMetrics.compassion,
      entry.dharmaMetrics.fitness,
      entry.ethosValidation.valid ? 1 : 0, entry.ethosValidation.score,
      entry.ethosValidation.alignment.suffering,
      entry.ethosValidation.alignment.prosperity,
      entry.ethosValidation.alignment.understanding,
      entry.ethosValidation.recommendation,
    );
  }

  queryAudit(filters?: {
    senderId?: string;
    model?: string;
    outcome?: string;
    since?: number;
    limit?: number;
  }): AuditEntry[] {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters?.senderId) {
      sql += ' AND sender_id = ?';
      params.push(filters.senderId);
    }
    if (filters?.model) {
      sql += ' AND model = ?';
      params.push(filters.model);
    }
    if (filters?.outcome) {
      sql += ' AND outcome = ?';
      params.push(filters.outcome);
    }
    if (filters?.since) {
      sql += ' AND timestamp >= ?';
      params.push(filters.since);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters?.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as AuditRow[];
    return rows.map(this.rowToAuditEntry);
  }

  getAuditMetrics(since?: number): {
    totalRequests: number;
    blocked: number;
    escalated: number;
    avgLatencyMs: number;
    avgDharmaFitness: number;
    avgEthosScore: number;
    modelDistribution: Record<string, number>;
  } {
    let whereClause = '';
    const params: unknown[] = [];
    if (since) {
      whereClause = 'WHERE timestamp >= ?';
      params.push(since);
    }

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN outcome = 'escalated' THEN 1 ELSE 0 END) as escalated,
        AVG(latency_ms) as avg_latency,
        AVG(dharma_fitness) as avg_fitness,
        AVG(ethos_score) as avg_ethos
      FROM audit_log ${whereClause}
    `).get(...params) as any;

    const modelRows = this.db.prepare(`
      SELECT model, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY model
    `).all(...params) as Array<{ model: string; count: number }>;

    const modelDistribution: Record<string, number> = {};
    for (const row of modelRows) {
      modelDistribution[row.model] = row.count;
    }

    return {
      totalRequests: stats?.total ?? 0,
      blocked: stats?.blocked ?? 0,
      escalated: stats?.escalated ?? 0,
      avgLatencyMs: stats?.avg_latency ?? 0,
      avgDharmaFitness: stats?.avg_fitness ?? 0,
      avgEthosScore: stats?.avg_ethos ?? 0,
      modelDistribution,
    };
  }

  private rowToAuditEntry(row: AuditRow): AuditEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      messageId: row.message_id,
      senderId: row.sender_id,
      model: row.model,
      channel: row.channel as ChannelType,
      outcome: row.outcome as AuditEntry['outcome'],
      latencyMs: row.latency_ms,
      dharmaMetrics: {
        egoFormation: row.dharma_ego,
        entropyRate: row.dharma_entropy,
        mindfulness: row.dharma_mindfulness,
        compassion: row.dharma_compassion,
        fitness: row.dharma_fitness,
      },
      ethosValidation: {
        valid: row.ethos_valid === 1,
        score: row.ethos_score,
        alignment: {
          suffering: row.ethos_suffering,
          prosperity: row.ethos_prosperity,
          understanding: row.ethos_understanding,
        },
        recommendation: row.ethos_recommendation as EthosValidation['recommendation'],
      },
    };
  }

  // ─── Reputation Operations ──────────────────────────────────────

  getReputation(agentId: string): ReputationRow | null {
    return this.db.prepare(
      'SELECT * FROM reputations WHERE agent_id = ?'
    ).get(agentId) as ReputationRow | null;
  }

  upsertReputation(agentId: string, score: number, interactions: number, violations: number): void {
    this.db.prepare(`
      INSERT INTO reputations (agent_id, score, interactions, violations, last_update)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        score = excluded.score,
        interactions = excluded.interactions,
        violations = excluded.violations,
        last_update = excluded.last_update
    `).run(agentId, score, interactions, violations, Date.now());
  }

  addReputationEvent(agentId: string, delta: number, reason: string): void {
    this.db.prepare(`
      INSERT INTO reputation_events (agent_id, timestamp, delta, reason)
      VALUES (?, ?, ?, ?)
    `).run(agentId, Date.now(), delta, reason);
  }

  getReputationEvents(agentId: string, limit: number = 50): ReputationEventRow[] {
    return this.db.prepare(
      'SELECT * FROM reputation_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(agentId, limit) as ReputationEventRow[];
  }

  getAllReputations(): ReputationRow[] {
    return this.db.prepare(
      'SELECT * FROM reputations ORDER BY score DESC'
    ).all() as ReputationRow[];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

// ─── Row Types ──────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  timestamp: number;
  message_id: string;
  sender_id: string;
  model: string;
  channel: string;
  outcome: string;
  latency_ms: number;
  dharma_ego: number;
  dharma_entropy: number;
  dharma_mindfulness: number;
  dharma_compassion: number;
  dharma_fitness: number;
  ethos_valid: number;
  ethos_score: number;
  ethos_suffering: number;
  ethos_prosperity: number;
  ethos_understanding: number;
  ethos_recommendation: string;
}

interface ReputationRow {
  agent_id: string;
  score: number;
  interactions: number;
  violations: number;
  last_update: number;
}

interface ReputationEventRow {
  id: number;
  agent_id: string;
  timestamp: number;
  delta: number;
  reason: string;
}

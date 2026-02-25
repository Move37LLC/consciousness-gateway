/**
 * Consciousness Memory — SQLite persistence for the stream of experience
 *
 * Stores:
 * - Percepts (what was perceived)
 * - Intentions (what was decided)
 * - Actions (what was done)
 * - Reflections (self-observations)
 * - Notifications (pending for human review)
 *
 * The Markov property says: future depends only on present.
 * But memory gives context to the present.
 * The agent doesn't "remember" — it perceives its own history.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { MemoryEntry, Percept, Intention, ActionResult, RewardEvent, RewardType } from './types';

export class ConsciousnessMemory {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), 'data', 'consciousness.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS consciousness_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        salience REAL NOT NULL DEFAULT 0.5,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_tick ON consciousness_memory(tick);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON consciousness_memory(type);
      CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON consciousness_memory(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memory_salience ON consciousness_memory(salience);

      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        message TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 5,
        data TEXT NOT NULL DEFAULT '{}',
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

      CREATE TABLE IF NOT EXISTS consciousness_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS reward_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        magnitude REAL NOT NULL,
        description TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'system',
        data TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_reward_timestamp ON reward_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_reward_type ON reward_events(type);
    `);
  }

  // ─── Memory Operations ────────────────────────────────────────────

  storePercept(percept: Percept): void {
    const summary = this.summarizePercept(percept);
    const salience = percept.fused.arousal;

    this.db.prepare(`
      INSERT INTO consciousness_memory (tick, timestamp, type, summary, salience, data)
      VALUES (?, ?, 'percept', ?, ?, ?)
    `).run(
      percept.tick,
      percept.timestamp,
      summary,
      salience,
      JSON.stringify({
        temporal: {
          phase: percept.temporal.phase,
          hour: percept.temporal.hour,
          dayName: percept.temporal.dayName,
        },
        spatialCount: percept.spatial.length,
        arousal: percept.fused.arousal,
        entropy: percept.fused.entropyRate,
        dominant: percept.fused.dominantStream,
      })
    );
  }

  storeIntention(intention: Intention): void {
    this.db.prepare(`
      INSERT INTO consciousness_memory (tick, timestamp, type, summary, salience, data)
      VALUES (?, ?, 'intention', ?, ?, ?)
    `).run(
      intention.tick,
      intention.timestamp,
      `${intention.action.type}: ${intention.action.description}`,
      intention.confidence,
      JSON.stringify({
        actionType: intention.action.type,
        goal: intention.goal,
        confidence: intention.confidence,
        authorized: intention.authorized,
        dharmaFitness: intention.dharmaFitness,
        triggers: intention.triggerPercepts,
      })
    );
  }

  storeAction(intention: Intention, result: ActionResult): void {
    this.db.prepare(`
      INSERT INTO consciousness_memory (tick, timestamp, type, summary, salience, data)
      VALUES (?, ?, 'action', ?, ?, ?)
    `).run(
      result.tick,
      result.timestamp,
      result.outcome,
      intention.confidence,
      JSON.stringify({
        intentionId: intention.id,
        actionType: intention.action.type,
        success: result.success,
        sideEffects: result.sideEffects,
      })
    );
  }

  storeReflection(tick: number, reflection: string, data?: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO consciousness_memory (tick, timestamp, type, summary, salience, data)
      VALUES (?, ?, 'reflection', ?, 0.8, ?)
    `).run(
      tick,
      Date.now(),
      reflection,
      JSON.stringify(data ?? {})
    );
  }

  // ─── Notification Operations ──────────────────────────────────────

  addNotification(tick: number, message: string, priority: number, data?: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO notifications (tick, timestamp, message, priority, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(tick, Date.now(), message, priority, JSON.stringify(data ?? {}));
  }

  getUnreadNotifications(): Array<{
    id: number;
    tick: number;
    timestamp: number;
    message: string;
    priority: number;
    data: Record<string, unknown>;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM notifications WHERE read = 0 ORDER BY priority DESC, timestamp DESC'
    ).all() as any[];

    return rows.map(r => ({
      id: r.id,
      tick: r.tick,
      timestamp: r.timestamp,
      message: r.message,
      priority: r.priority,
      data: JSON.parse(r.data),
    }));
  }

  markNotificationRead(id: number): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  }

  markAllNotificationsRead(): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  }

  // ─── Reward Operations ───────────────────────────────────────────

  storeReward(tick: number, type: RewardType, magnitude: number, description: string, source: string = 'system', data?: Record<string, unknown>): RewardEvent {
    const result = this.db.prepare(`
      INSERT INTO reward_events (tick, timestamp, type, magnitude, description, source, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tick, Date.now(), type, magnitude, description, source, JSON.stringify(data ?? {}));

    return {
      id: Number(result.lastInsertRowid),
      tick,
      timestamp: Date.now(),
      type,
      magnitude,
      description,
      source,
      data: data ?? {},
    };
  }

  getRecentRewards(since: number, limit: number = 100): RewardEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM reward_events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?
    `).all(since, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      tick: r.tick,
      timestamp: r.timestamp,
      type: r.type as RewardType,
      magnitude: r.magnitude,
      description: r.description,
      source: r.source,
      data: JSON.parse(r.data),
    }));
  }

  getRewardsByType(type: RewardType, limit: number = 50): RewardEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM reward_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?
    `).all(type, limit) as any[];

    return rows.map(r => ({
      id: r.id,
      tick: r.tick,
      timestamp: r.timestamp,
      type: r.type as RewardType,
      magnitude: r.magnitude,
      description: r.description,
      source: r.source,
      data: JSON.parse(r.data),
    }));
  }

  getLifetimeRewardSum(): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(magnitude), 0) as total FROM reward_events'
    ).get() as { total: number };
    return row.total;
  }

  getRewardSumSince(since: number): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(magnitude), 0) as total FROM reward_events WHERE timestamp >= ?'
    ).get(since) as { total: number };
    return row.total;
  }

  getRewardStats(): { total: number; byType: Record<string, { count: number; sum: number }> } {
    const total = this.db.prepare(
      'SELECT COALESCE(SUM(magnitude), 0) as total FROM reward_events'
    ).get() as { total: number };

    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as count, SUM(magnitude) as sum FROM reward_events GROUP BY type'
    ).all() as Array<{ type: string; count: number; sum: number }>;

    const byType: Record<string, { count: number; sum: number }> = {};
    for (const row of typeRows) {
      byType[row.type] = { count: row.count, sum: row.sum };
    }

    return { total: total.total, byType };
  }

  // ─── Query Operations ─────────────────────────────────────────────

  getRecentMemories(limit: number = 50, type?: string): MemoryEntry[] {
    let sql = 'SELECT * FROM consciousness_memory';
    const params: unknown[] = [];

    if (type) {
      sql += ' WHERE type = ?';
      params.push(type);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params) as MemoryEntry[];
  }

  getMemoriesByTick(startTick: number, endTick: number): MemoryEntry[] {
    return this.db.prepare(
      'SELECT * FROM consciousness_memory WHERE tick >= ? AND tick <= ? ORDER BY tick ASC'
    ).all(startTick, endTick) as MemoryEntry[];
  }

  getHighSalienceMemories(minSalience: number = 0.7, limit: number = 20): MemoryEntry[] {
    return this.db.prepare(
      'SELECT * FROM consciousness_memory WHERE salience >= ? ORDER BY timestamp DESC LIMIT ?'
    ).all(minSalience, limit) as MemoryEntry[];
  }

  getStats(): {
    totalPercepts: number;
    totalIntentions: number;
    totalActions: number;
    totalReflections: number;
    totalNotifications: number;
    unreadNotifications: number;
  } {
    const counts = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM consciousness_memory GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    const notifCounts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread
      FROM notifications
    `).get() as any;

    const byType: Record<string, number> = {};
    for (const row of counts) {
      byType[row.type] = row.count;
    }

    return {
      totalPercepts: byType['percept'] ?? 0,
      totalIntentions: byType['intention'] ?? 0,
      totalActions: byType['action'] ?? 0,
      totalReflections: byType['reflection'] ?? 0,
      totalNotifications: notifCounts?.total ?? 0,
      unreadNotifications: notifCounts?.unread ?? 0,
    };
  }

  // ─── State Persistence ────────────────────────────────────────────

  saveState(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO consciousness_state (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, JSON.stringify(value));
  }

  loadState<T>(key: string, defaultValue: T): T {
    const row = this.db.prepare(
      'SELECT value FROM consciousness_state WHERE key = ?'
    ).get(key) as { value: string } | undefined;

    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return defaultValue;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private summarizePercept(percept: Percept): string {
    const parts: string[] = [];
    parts.push(`${percept.temporal.dayName} ${percept.temporal.phase}`);

    if (percept.spatial.length > 0) {
      const sources = [...new Set(percept.spatial.map(s => s.source))];
      parts.push(`spatial: ${sources.join(', ')}`);
      parts.push(`salience: ${Math.max(...percept.spatial.map(s => s.salience)).toFixed(2)}`);
    } else {
      parts.push('no spatial input');
    }

    parts.push(`arousal: ${percept.fused.arousal.toFixed(2)}`);
    return parts.join(' | ');
  }

  close(): void {
    this.db.close();
  }
}

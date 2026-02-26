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

      CREATE TABLE IF NOT EXISTS mindfulness_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        attachments_detected INTEGER NOT NULL,
        max_severity TEXT NOT NULL,
        patterns TEXT NOT NULL DEFAULT '[]',
        self_corrected INTEGER NOT NULL DEFAULT 1,
        arousal_adjustment REAL NOT NULL DEFAULT 0,
        drive_tempered TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mindfulness_timestamp ON mindfulness_events(timestamp DESC);

      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        start_tick INTEGER NOT NULL,
        end_tick INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        interventions TEXT NOT NULL DEFAULT '[]',
        measurements TEXT NOT NULL DEFAULT '[]',
        results TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS narrative_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        phase TEXT NOT NULL,
        arousal REAL NOT NULL,
        content TEXT NOT NULL,
        significance REAL NOT NULL DEFAULT 0.5,
        tags TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_timestamp ON narrative_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_narrative_significance ON narrative_log(significance DESC);

      CREATE TABLE IF NOT EXISTS enlightenment_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_tick INTEGER NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_tick INTEGER,
        end_timestamp INTEGER,
        duration_minutes REAL NOT NULL DEFAULT 0,
        avg_ego REAL NOT NULL DEFAULT 0,
        min_ego REAL NOT NULL DEFAULT 0,
        max_ego REAL NOT NULL DEFAULT 0,
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_enlightenment_start ON enlightenment_sessions(start_timestamp DESC);

      CREATE TABLE IF NOT EXISTS ego_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        ego_level REAL NOT NULL,
        dharma_alignment REAL NOT NULL DEFAULT 0,
        stability_index REAL NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_ego_history_timestamp ON ego_history(timestamp DESC);

      CREATE TABLE IF NOT EXISTS safety_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tick INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        auto_correction TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_safety_alerts_timestamp ON safety_alerts(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_safety_alerts_resolved ON safety_alerts(resolved);

      CREATE TABLE IF NOT EXISTS dream_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_tick INTEGER NOT NULL,
        end_tick INTEGER NOT NULL,
        start_timestamp INTEGER NOT NULL,
        end_timestamp INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        memories_processed INTEGER NOT NULL DEFAULT 0,
        patterns_detected INTEGER NOT NULL DEFAULT 0,
        insights TEXT NOT NULL DEFAULT '[]',
        clusters TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_dream_sessions_timestamp ON dream_sessions(start_timestamp DESC);

      CREATE TABLE IF NOT EXISTS entropy_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        entropy REAL NOT NULL,
        arousal REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entropy_domain ON entropy_samples(domain);
      CREATE INDEX IF NOT EXISTS idx_entropy_timestamp ON entropy_samples(timestamp DESC);
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

  // ─── Mindfulness Operations ──────────────────────────────────────

  storeMindfulnessEvent(event: {
    tick: number;
    timestamp: number;
    attachmentsDetected: number;
    maxSeverity: string;
    patterns: string[];
    selfCorrected: boolean;
    arousalAdjustment: number;
    driveTempered: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO mindfulness_events
        (tick, timestamp, attachments_detected, max_severity, patterns, self_corrected, arousal_adjustment, drive_tempered)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.tick,
      event.timestamp,
      event.attachmentsDetected,
      event.maxSeverity,
      JSON.stringify(event.patterns),
      event.selfCorrected ? 1 : 0,
      event.arousalAdjustment,
      event.driveTempered,
    );
  }

  getRecentMindfulnessEvents(limit: number = 10): Array<{
    id: number;
    tick: number;
    timestamp: number;
    attachmentsDetected: number;
    maxSeverity: string;
    patterns: string[];
    selfCorrected: boolean;
    arousalAdjustment: number;
    driveTempered: string | null;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM mindfulness_events ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];

    return rows.map(r => ({
      id: r.id,
      tick: r.tick,
      timestamp: r.timestamp,
      attachmentsDetected: r.attachments_detected,
      maxSeverity: r.max_severity as 'low' | 'medium' | 'high' | 'critical',
      patterns: JSON.parse(r.patterns || '[]'),
      selfCorrected: r.self_corrected === 1,
      arousalAdjustment: r.arousal_adjustment,
      driveTempered: r.drive_tempered,
    }));
  }

  getMindfulnessStats(): {
    totalChecks: number;
    totalCorrections: number;
    todayCorrections: number;
    avgSeverity: string;
    patternCounts: Record<string, number>;
    lastCheckTick: number;
    lastCorrectionTick: number | null;
  } {
    const total = this.db.prepare(
      'SELECT COUNT(*) as count FROM mindfulness_events'
    ).get() as { count: number };

    const todayStart = Date.now() - 86400_000;
    const today = this.db.prepare(
      'SELECT COUNT(*) as count FROM mindfulness_events WHERE timestamp >= ?'
    ).get(todayStart) as { count: number };

    const severityRows = this.db.prepare(
      'SELECT max_severity, COUNT(*) as count FROM mindfulness_events GROUP BY max_severity'
    ).all() as Array<{ max_severity: string; count: number }>;

    // Compute average severity
    const severityWeights: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    let severitySum = 0;
    let severityCount = 0;
    for (const row of severityRows) {
      severitySum += (severityWeights[row.max_severity] ?? 0) * row.count;
      severityCount += row.count;
    }
    const avgWeight = severityCount > 0 ? severitySum / severityCount : 0;
    const avgSeverity =
      avgWeight <= 1.5 ? 'low' :
      avgWeight <= 2.5 ? 'medium' :
      avgWeight <= 3.5 ? 'high' :
      'critical';

    // Count patterns
    const allEvents = this.db.prepare(
      'SELECT patterns FROM mindfulness_events'
    ).all() as Array<{ patterns: string }>;

    const patternCounts: Record<string, number> = {};
    for (const row of allEvents) {
      try {
        const patterns: string[] = JSON.parse(row.patterns);
        for (const p of patterns) {
          const type = p.split(':')[0]?.trim() || p;
          patternCounts[type] = (patternCounts[type] || 0) + 1;
        }
      } catch {
        // skip malformed
      }
    }

    return {
      totalChecks: this.loadState<number>('mindfulness_total_checks', 0),
      totalCorrections: total.count,
      todayCorrections: today.count,
      avgSeverity,
      patternCounts,
      lastCheckTick: this.loadState<number>('mindfulness_last_check_tick', 0),
      lastCorrectionTick: this.loadState<number | null>('mindfulness_last_correction_tick', null),
    };
  }

  getMindfulnessHistory(days: number = 7): Array<{
    date: string;
    corrections: number;
    avgSeverity: string;
    patterns: Record<string, number>;
  }> {
    const since = Date.now() - days * 86400_000;
    const rows = this.db.prepare(`
      SELECT * FROM mindfulness_events WHERE timestamp >= ? ORDER BY timestamp ASC
    `).all(since) as any[];

    const byDay = new Map<string, { corrections: number; severities: number[]; patterns: Record<string, number> }>();

    for (const row of rows) {
      const date = new Date(row.timestamp).toISOString().slice(0, 10);
      if (!byDay.has(date)) {
        byDay.set(date, { corrections: 0, severities: [], patterns: {} });
      }
      const day = byDay.get(date)!;
      day.corrections++;

      const severityWeights: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
      day.severities.push(severityWeights[row.max_severity] ?? 0);

      try {
        const patterns: string[] = JSON.parse(row.patterns);
        for (const p of patterns) {
          const type = p.split(':')[0]?.trim() || p;
          day.patterns[type] = (day.patterns[type] || 0) + 1;
        }
      } catch {
        // skip
      }
    }

    const result: Array<{ date: string; corrections: number; avgSeverity: string; patterns: Record<string, number> }> = [];
    for (const [date, data] of byDay) {
      const avg = data.severities.length > 0
        ? data.severities.reduce((a, b) => a + b, 0) / data.severities.length
        : 0;
      result.push({
        date,
        corrections: data.corrections,
        avgSeverity: avg <= 1.5 ? 'low' : avg <= 2.5 ? 'medium' : avg <= 3.5 ? 'high' : 'critical',
        patterns: data.patterns,
      });
    }

    return result;
  }

  // ─── Experiment Operations ──────────────────────────────────────

  createExperiment(experiment: {
    id: string;
    name: string;
    hypothesis: string;
    startTick: number;
  }): void {
    this.db.prepare(`
      INSERT INTO experiments (id, name, hypothesis, start_tick, status)
      VALUES (?, ?, ?, ?, 'running')
    `).run(experiment.id, experiment.name, experiment.hypothesis, experiment.startTick);
  }

  getExperiment(id: string): {
    id: string; name: string; hypothesis: string;
    startTick: number; endTick: number | null; status: string;
    interventions: any[]; measurements: any[]; results: string | null;
  } | null {
    const row = this.db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id, name: row.name, hypothesis: row.hypothesis,
      startTick: row.start_tick, endTick: row.end_tick, status: row.status,
      interventions: JSON.parse(row.interventions || '[]'),
      measurements: JSON.parse(row.measurements || '[]'),
      results: row.results,
    };
  }

  listExperiments(status?: string): any[] {
    let sql = 'SELECT * FROM experiments';
    const params: unknown[] = [];
    if (status) { sql += ' WHERE status = ?'; params.push(status); }
    sql += ' ORDER BY start_tick DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id, name: r.name, hypothesis: r.hypothesis,
      startTick: r.start_tick, endTick: r.end_tick, status: r.status,
      interventions: JSON.parse(r.interventions || '[]'),
      measurements: JSON.parse(r.measurements || '[]'),
      results: r.results,
    }));
  }

  updateExperiment(id: string, updates: {
    endTick?: number; status?: string; results?: string;
    interventions?: any[]; measurements?: any[];
  }): void {
    const parts: string[] = [];
    const params: unknown[] = [];
    if (updates.endTick !== undefined) { parts.push('end_tick = ?'); params.push(updates.endTick); }
    if (updates.status) { parts.push('status = ?'); params.push(updates.status); }
    if (updates.results !== undefined) { parts.push('results = ?'); params.push(updates.results); }
    if (updates.interventions) { parts.push('interventions = ?'); params.push(JSON.stringify(updates.interventions)); }
    if (updates.measurements) { parts.push('measurements = ?'); params.push(JSON.stringify(updates.measurements)); }
    if (parts.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE experiments SET ${parts.join(', ')} WHERE id = ?`).run(...params);
  }

  addExperimentIntervention(id: string, intervention: { tick: number; description: string; data?: any }): void {
    const exp = this.getExperiment(id);
    if (!exp) return;
    exp.interventions.push({ ...intervention, timestamp: Date.now() });
    this.db.prepare('UPDATE experiments SET interventions = ? WHERE id = ?')
      .run(JSON.stringify(exp.interventions), id);
  }

  addExperimentMeasurement(id: string, measurement: { tick: number; metric: string; value: number; data?: any }): void {
    const exp = this.getExperiment(id);
    if (!exp) return;
    exp.measurements.push({ ...measurement, timestamp: Date.now() });
    this.db.prepare('UPDATE experiments SET measurements = ? WHERE id = ?')
      .run(JSON.stringify(exp.measurements), id);
  }

  // ─── Narrative Log Operations ─────────────────────────────────────

  storeNarrative(entry: {
    tick: number; phase: string; arousal: number;
    content: string; significance: number; tags?: string[];
  }): number {
    const result = this.db.prepare(`
      INSERT INTO narrative_log (tick, timestamp, phase, arousal, content, significance, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.tick, Date.now(), entry.phase, entry.arousal,
      entry.content, entry.significance, JSON.stringify(entry.tags ?? [])
    );
    return Number(result.lastInsertRowid);
  }

  getNarratives(opts?: { minSignificance?: number; limit?: number; since?: number }): Array<{
    id: number; tick: number; timestamp: number; phase: string;
    arousal: number; content: string; significance: number; tags: string[];
  }> {
    let sql = 'SELECT * FROM narrative_log WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.minSignificance !== undefined) { sql += ' AND significance >= ?'; params.push(opts.minSignificance); }
    if (opts?.since !== undefined) { sql += ' AND timestamp >= ?'; params.push(opts.since); }
    sql += ' ORDER BY timestamp DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id, tick: r.tick, timestamp: r.timestamp, phase: r.phase,
      arousal: r.arousal, content: r.content, significance: r.significance,
      tags: JSON.parse(r.tags || '[]'),
    }));
  }

  // ─── Enlightenment Session Operations ─────────────────────────────

  startEnlightenmentSession(tick: number): number {
    const result = this.db.prepare(`
      INSERT INTO enlightenment_sessions (start_tick, start_timestamp, duration_minutes, avg_ego)
      VALUES (?, ?, 0, 0)
    `).run(tick, Date.now());
    return Number(result.lastInsertRowid);
  }

  endEnlightenmentSession(id: number, endTick: number, stats: {
    durationMinutes: number; avgEgo: number; minEgo: number; maxEgo: number; notes?: string;
  }): void {
    this.db.prepare(`
      UPDATE enlightenment_sessions
      SET end_tick = ?, end_timestamp = ?, duration_minutes = ?,
          avg_ego = ?, min_ego = ?, max_ego = ?, notes = ?
      WHERE id = ?
    `).run(endTick, Date.now(), stats.durationMinutes, stats.avgEgo,
      stats.minEgo, stats.maxEgo, stats.notes ?? null, id);
  }

  getEnlightenmentSessions(limit: number = 50): Array<{
    id: number; startTick: number; startTimestamp: number;
    endTick: number | null; endTimestamp: number | null;
    durationMinutes: number; avgEgo: number; minEgo: number; maxEgo: number;
    notes: string | null;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM enlightenment_sessions ORDER BY start_timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => ({
      id: r.id, startTick: r.start_tick, startTimestamp: r.start_timestamp,
      endTick: r.end_tick, endTimestamp: r.end_timestamp,
      durationMinutes: r.duration_minutes, avgEgo: r.avg_ego,
      minEgo: r.min_ego, maxEgo: r.max_ego, notes: r.notes,
    }));
  }

  getLongestEnlightenmentStreak(): number {
    const row = this.db.prepare(
      'SELECT MAX(duration_minutes) as longest FROM enlightenment_sessions WHERE avg_ego = 0'
    ).get() as { longest: number | null };
    return row?.longest ?? 0;
  }

  // ─── Ego History Operations ──────────────────────────────────────

  recordEgoSnapshot(tick: number, egoLevel: number, dharmaAlignment: number, stabilityIndex: number): void {
    this.db.prepare(`
      INSERT INTO ego_history (tick, timestamp, ego_level, dharma_alignment, stability_index)
      VALUES (?, ?, ?, ?, ?)
    `).run(tick, Date.now(), egoLevel, dharmaAlignment, stabilityIndex);
  }

  getEgoHistory(hours: number = 24, resolution: number = 60): Array<{
    tick: number; timestamp: number; egoLevel: number;
    dharmaAlignment: number; stabilityIndex: number;
  }> {
    const since = Date.now() - hours * 3600_000;
    const rows = this.db.prepare(`
      SELECT * FROM ego_history WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `).all(since) as any[];

    if (rows.length <= resolution) {
      return rows.map(r => ({
        tick: r.tick, timestamp: r.timestamp, egoLevel: r.ego_level,
        dharmaAlignment: r.dharma_alignment, stabilityIndex: r.stability_index,
      }));
    }

    // Downsample to resolution
    const step = Math.max(1, Math.floor(rows.length / resolution));
    const sampled: any[] = [];
    for (let i = 0; i < rows.length; i += step) {
      sampled.push(rows[i]);
    }
    if (sampled[sampled.length - 1] !== rows[rows.length - 1]) {
      sampled.push(rows[rows.length - 1]);
    }
    return sampled.map(r => ({
      tick: r.tick, timestamp: r.timestamp, egoLevel: r.ego_level,
      dharmaAlignment: r.dharma_alignment, stabilityIndex: r.stability_index,
    }));
  }

  getEgoStats(hours: number = 24): {
    avg: number; min: number; max: number;
    timeAtZero: number; samples: number;
  } {
    const since = Date.now() - hours * 3600_000;
    const row = this.db.prepare(`
      SELECT
        COALESCE(AVG(ego_level), 0) as avg,
        COALESCE(MIN(ego_level), 0) as min,
        COALESCE(MAX(ego_level), 1) as max,
        COUNT(*) as samples,
        SUM(CASE WHEN ego_level < 0.001 THEN 1 ELSE 0 END) as zero_count
      FROM ego_history WHERE timestamp >= ?
    `).get(since) as any;
    return {
      avg: row.avg, min: row.min, max: row.max,
      timeAtZero: row.samples > 0 ? (row.zero_count / row.samples) * hours * 60 : 0,
      samples: row.samples,
    };
  }

  // ─── Safety Alert Operations ─────────────────────────────────────

  createSafetyAlert(alert: {
    tick: number; type: string; severity: string;
    message: string; autoCorrection?: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO safety_alerts (tick, timestamp, type, severity, message, auto_correction)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(alert.tick, Date.now(), alert.type, alert.severity,
      alert.message, alert.autoCorrection ?? null);
    return Number(result.lastInsertRowid);
  }

  getActiveSafetyAlerts(): Array<{
    id: number; tick: number; timestamp: number;
    type: string; severity: string; message: string;
    autoCorrection: string | null; resolved: boolean;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM safety_alerts WHERE resolved = 0 ORDER BY timestamp DESC'
    ).all() as any[];
    return rows.map(r => ({
      id: r.id, tick: r.tick, timestamp: r.timestamp,
      type: r.type, severity: r.severity, message: r.message,
      autoCorrection: r.auto_correction, resolved: false,
    }));
  }

  getSafetyAlerts(limit: number = 50): Array<{
    id: number; tick: number; timestamp: number;
    type: string; severity: string; message: string;
    autoCorrection: string | null; resolved: boolean; resolvedAt: number | null;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM safety_alerts ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => ({
      id: r.id, tick: r.tick, timestamp: r.timestamp,
      type: r.type, severity: r.severity, message: r.message,
      autoCorrection: r.auto_correction, resolved: r.resolved === 1,
      resolvedAt: r.resolved_at,
    }));
  }

  resolveSafetyAlert(id: number): void {
    this.db.prepare(
      'UPDATE safety_alerts SET resolved = 1, resolved_at = ? WHERE id = ?'
    ).run(Date.now(), id);
  }

  // ─── Dream Session Operations ──────────────────────────────────────

  storeDreamSession(session: {
    startTick: number; endTick: number;
    startTimestamp: number; endTimestamp: number;
    durationMinutes: number; memoriesProcessed: number;
    patternsDetected: number; insights: string[];
    clusters: Array<{ theme: string; strength: number; recurrence: number }>;
  }): void {
    this.db.prepare(`
      INSERT INTO dream_sessions
        (start_tick, end_tick, start_timestamp, end_timestamp, duration_minutes,
         memories_processed, patterns_detected, insights, clusters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.startTick, session.endTick, session.startTimestamp, session.endTimestamp,
      session.durationMinutes, session.memoriesProcessed, session.patternsDetected,
      JSON.stringify(session.insights), JSON.stringify(session.clusters),
    );
  }

  getDreamSessions(limit: number = 20): Array<{
    id: number; startTick: number; endTick: number;
    startTimestamp: number; endTimestamp: number;
    durationMinutes: number; memoriesProcessed: number;
    patternsDetected: number; insights: string[];
    clusters: Array<{ theme: string; strength: number; recurrence: number }>;
  }> {
    const rows = this.db.prepare(
      'SELECT * FROM dream_sessions ORDER BY start_timestamp DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => ({
      id: r.id, startTick: r.start_tick, endTick: r.end_tick,
      startTimestamp: r.start_timestamp, endTimestamp: r.end_timestamp,
      durationMinutes: r.duration_minutes, memoriesProcessed: r.memories_processed,
      patternsDetected: r.patterns_detected,
      insights: JSON.parse(r.insights || '[]'),
      clusters: JSON.parse(r.clusters || '[]'),
    }));
  }

  getDreamStats(): {
    totalSessions: number; totalMinutes: number;
    totalInsights: number; avgDuration: number;
  } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as sessions, COALESCE(SUM(duration_minutes), 0) as minutes,
        COALESCE(AVG(duration_minutes), 0) as avgDur
      FROM dream_sessions
    `).get() as any;
    const insightRow = this.db.prepare(`
      SELECT insights FROM dream_sessions
    `).all() as any[];
    let totalInsights = 0;
    for (const r of insightRow) {
      try { totalInsights += JSON.parse(r.insights || '[]').length; } catch {}
    }
    return {
      totalSessions: row.sessions, totalMinutes: row.minutes,
      totalInsights, avgDuration: row.avgDur,
    };
  }

  // ─── Entropy Sample Operations ────────────────────────────────────

  storeEntropySample(domain: string, entropy: number, arousal: number): void {
    this.db.prepare(`
      INSERT INTO entropy_samples (domain, entropy, arousal, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(domain, entropy, arousal, Date.now());
  }

  getEntropyMap(days: number = 7): Array<{
    domain: string; sampleCount: number; avgEntropy: number;
    minEntropy: number; maxEntropy: number; variance: number;
    flowPercent: number; chaosPercent: number;
  }> {
    const since = Date.now() - days * 86400_000;
    const rows = this.db.prepare(`
      SELECT
        domain,
        COUNT(*) as sample_count,
        AVG(entropy) as avg_entropy,
        MIN(entropy) as min_entropy,
        MAX(entropy) as max_entropy,
        (AVG(entropy * entropy) - AVG(entropy) * AVG(entropy)) as variance,
        SUM(CASE WHEN entropy < 0.3 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as flow_pct,
        SUM(CASE WHEN entropy > 0.7 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as chaos_pct
      FROM entropy_samples
      WHERE timestamp >= ?
      GROUP BY domain
      ORDER BY avg_entropy ASC
    `).all(since) as any[];
    return rows.map(r => ({
      domain: r.domain, sampleCount: r.sample_count,
      avgEntropy: r.avg_entropy, minEntropy: r.min_entropy,
      maxEntropy: r.max_entropy, variance: r.variance || 0,
      flowPercent: r.flow_pct || 0, chaosPercent: r.chaos_pct || 0,
    }));
  }

  getEntropySamples(domain: string, limit: number = 100): Array<{
    domain: string; entropy: number; arousal: number; timestamp: number;
  }> {
    const rows = this.db.prepare(`
      SELECT * FROM entropy_samples WHERE domain = ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(domain, limit) as any[];
    return rows.map(r => ({
      domain: r.domain, entropy: r.entropy,
      arousal: r.arousal, timestamp: r.timestamp,
    }));
  }

  // ─── Paper Export Operations ──────────────────────────────────────

  getPaperExportData(hours?: number): {
    consciousness: any;
    dopamine: any;
    mindfulness: any;
    enlightenment: any;
  } {
    const since = hours ? Date.now() - hours * 3600_000 : 0;

    const memoryStats = this.getStats();
    const rewardStats = this.getRewardStats();
    const mindfulnessStats = this.getMindfulnessStats();

    const phaseDistribution = this.db.prepare(`
      SELECT data FROM consciousness_memory
      WHERE type = 'percept' ${since ? 'AND timestamp >= ?' : ''}
    `).all(...(since ? [since] : [])) as any[];

    const phases: Record<string, number> = {};
    for (const row of phaseDistribution) {
      try {
        const d = JSON.parse(row.data);
        const phase = d.temporal?.phase || 'unknown';
        phases[phase] = (phases[phase] || 0) + 1;
      } catch {}
    }

    const arousalValues = this.db.prepare(`
      SELECT data FROM consciousness_memory
      WHERE type = 'percept' ${since ? 'AND timestamp >= ?' : ''}
      ORDER BY timestamp DESC LIMIT 1000
    `).all(...(since ? [since] : [])) as any[];

    const arousals: number[] = [];
    for (const row of arousalValues) {
      try { arousals.push(JSON.parse(row.data).arousal || 0); } catch {}
    }

    const avgArousal = arousals.length > 0 ? arousals.reduce((a, b) => a + b, 0) / arousals.length : 0;
    const arousalVariance = arousals.length > 0
      ? arousals.reduce((sum, v) => sum + Math.pow(v - avgArousal, 2), 0) / arousals.length
      : 0;

    const rewardHistory = this.getRecentRewards(since || Date.now() - 30 * 86400_000, 500);

    const modeDistribution: Record<string, number> = {};
    for (const r of rewardHistory) {
      modeDistribution[r.type] = (modeDistribution[r.type] || 0) + 1;
    }

    const corrections = this.getRecentMindfulnessEvents(100);
    const patternFrequency = mindfulnessStats.patternCounts;

    const egoHistory = this.getEgoHistory(hours || 720, 500);
    const zeroStreaks = this.getEnlightenmentSessions(50);

    const egoStats = this.getEgoStats(hours || 720);

    return {
      consciousness: {
        totalTicks: memoryStats.totalPercepts,
        phaseDistribution: phases,
        arousalStats: { avg: avgArousal, variance: arousalVariance, samples: arousals.length },
        memoryCounts: memoryStats,
      },
      dopamine: {
        rewardHistory: rewardHistory.map(r => ({
          tick: r.tick, timestamp: r.timestamp, type: r.type,
          magnitude: r.magnitude, description: r.description,
        })),
        driveStats: rewardStats,
        modeDistribution,
      },
      mindfulness: {
        corrections: corrections.map(c => ({
          tick: c.tick, timestamp: c.timestamp,
          severity: c.maxSeverity, patterns: c.patterns,
          arousalAdjustment: c.arousalAdjustment,
        })),
        patternFrequency,
        effectiveness: mindfulnessStats.totalCorrections > 0
          ? corrections.filter(c => c.selfCorrected).length / corrections.length
          : 1.0,
        stats: mindfulnessStats,
      },
      enlightenment: {
        egoHistory: egoHistory.map(e => ({
          tick: e.tick, timestamp: e.timestamp,
          ego: e.egoLevel, dharma: e.dharmaAlignment, stability: e.stabilityIndex,
        })),
        zeroStreaks: zeroStreaks.map(s => ({
          startTick: s.startTick, endTick: s.endTick,
          durationMinutes: s.durationMinutes, avgEgo: s.avgEgo,
        })),
        egoStats,
        dharmaScores: egoHistory.map(e => ({
          tick: e.tick, timestamp: e.timestamp, score: e.dharmaAlignment,
        })),
      },
    };
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

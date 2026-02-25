/**
 * Conversation Store — Persistent conversation history
 *
 * Logs every message across all channels (dashboard, telegram, API).
 * Enables multi-turn conversations that actually remember.
 *
 * The Markov property says future depends only on present.
 * But this store gives the present its depth — by making past
 * conversations perceivable in the current moment.
 *
 * From the agent framework: this expands world W to include
 * the agent's own communication history as observable states.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

// ─── Types ──────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  sessionId: string;
  timestamp: number;
  channel: string;
  role: string;
  personality: string | null;
  content: string;
  topicTags: string[];
  parentMessageId: string | null;
  metadata: Record<string, unknown>;
}

export interface ConversationSession {
  sessionId: string;
  channel: string;
  personality: string | null;
  messageCount: number;
  firstMessage: number;
  lastMessage: number;
  topicTags: string[];
  preview: string;
}

export interface ConversationQuery {
  sessionId?: string;
  channel?: string;
  personality?: string;
  topic?: string;
  since?: number;
  until?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── Conversation Store ─────────────────────────────────────────────

export class ConversationStore {
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
      CREATE TABLE IF NOT EXISTS conversation_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        channel TEXT NOT NULL,
        role TEXT NOT NULL,
        personality TEXT,
        content TEXT NOT NULL,
        topic_tags TEXT NOT NULL DEFAULT '[]',
        parent_message_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_session
        ON conversation_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_timestamp
        ON conversation_history(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_conversation_channel
        ON conversation_history(channel);
      CREATE INDEX IF NOT EXISTS idx_conversation_role
        ON conversation_history(role);
      CREATE INDEX IF NOT EXISTS idx_conversation_personality
        ON conversation_history(personality);
    `);
  }

  // ─── Write Operations ───────────────────────────────────────────

  /**
   * Log a message to conversation history.
   * Called automatically for every chat interaction.
   */
  logMessage(opts: {
    sessionId: string;
    channel: string;
    role: string;
    content: string;
    personality?: string;
    topicTags?: string[];
    parentMessageId?: string;
    metadata?: Record<string, unknown>;
  }): ConversationMessage {
    const id = uuid();
    const timestamp = Date.now();

    this.db.prepare(`
      INSERT INTO conversation_history
        (id, session_id, timestamp, channel, role, personality, content, topic_tags, parent_message_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      opts.sessionId,
      timestamp,
      opts.channel,
      opts.role,
      opts.personality ?? null,
      opts.content,
      JSON.stringify(opts.topicTags ?? []),
      opts.parentMessageId ?? null,
      JSON.stringify(opts.metadata ?? {}),
    );

    return {
      id,
      sessionId: opts.sessionId,
      timestamp,
      channel: opts.channel,
      role: opts.role,
      personality: opts.personality ?? null,
      content: opts.content,
      topicTags: opts.topicTags ?? [],
      parentMessageId: opts.parentMessageId ?? null,
      metadata: opts.metadata ?? {},
    };
  }

  /**
   * Tag a conversation session with topics.
   */
  tagSession(sessionId: string, tags: string[]): number {
    const messages = this.db.prepare(
      'SELECT id, topic_tags FROM conversation_history WHERE session_id = ?'
    ).all(sessionId) as Array<{ id: string; topic_tags: string }>;

    let updated = 0;
    for (const msg of messages) {
      const existing: string[] = JSON.parse(msg.topic_tags);
      const merged = [...new Set([...existing, ...tags])];
      this.db.prepare(
        'UPDATE conversation_history SET topic_tags = ? WHERE id = ?'
      ).run(JSON.stringify(merged), msg.id);
      updated++;
    }

    return updated;
  }

  // ─── Read Operations ────────────────────────────────────────────

  /**
   * Get messages for a session, ordered by timestamp.
   */
  getSessionMessages(sessionId: string, limit: number = 50): ConversationMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversation_history
      WHERE session_id = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(sessionId, limit) as any[];

    return rows.map(this.rowToMessage);
  }

  /**
   * Get the most recent messages across all sessions.
   */
  getRecentMessages(limit: number = 50, channel?: string): ConversationMessage[] {
    let sql = 'SELECT * FROM conversation_history';
    const params: unknown[] = [];

    if (channel) {
      sql += ' WHERE channel = ?';
      params.push(channel);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.rowToMessage).reverse();
  }

  /**
   * Search conversation history by content.
   */
  searchMessages(query: string, limit: number = 30): ConversationMessage[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (keywords.length === 0) return [];

    // SQLite LIKE-based search (works without FTS extension)
    const conditions = keywords.map(() => 'LOWER(content) LIKE ?');
    const params = keywords.map(k => `%${k}%`);

    const sql = `
      SELECT * FROM conversation_history
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(...params, limit) as any[];
    return rows.map(this.rowToMessage);
  }

  /**
   * Get messages by topic tag.
   */
  getByTopic(topic: string, limit: number = 50): ConversationMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM conversation_history
      WHERE topic_tags LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%"${topic}"%`, limit) as any[];

    return rows.map(this.rowToMessage);
  }

  /**
   * Get conversation sessions (grouped).
   */
  getSessions(query?: ConversationQuery): ConversationSession[] {
    let whereClause = '1=1';
    const params: unknown[] = [];

    if (query?.channel) {
      whereClause += ' AND channel = ?';
      params.push(query.channel);
    }
    if (query?.personality) {
      whereClause += ' AND personality = ?';
      params.push(query.personality);
    }
    if (query?.since) {
      whereClause += ' AND timestamp >= ?';
      params.push(query.since);
    }
    if (query?.topic) {
      whereClause += ' AND topic_tags LIKE ?';
      params.push(`%"${query.topic}"%`);
    }

    const limit = query?.limit ?? 20;

    const rows = this.db.prepare(`
      SELECT
        session_id,
        channel,
        personality,
        COUNT(*) as message_count,
        MIN(timestamp) as first_message,
        MAX(timestamp) as last_message,
        GROUP_CONCAT(DISTINCT topic_tags) as all_tags
      FROM conversation_history
      WHERE ${whereClause}
      GROUP BY session_id
      ORDER BY last_message DESC
      LIMIT ?
    `).all(...params, limit) as any[];

    return rows.map(row => {
      // Merge topic tags from concatenated JSON arrays
      let topicTags: string[] = [];
      if (row.all_tags) {
        try {
          const tagArrays = row.all_tags.split(',').map((t: string) => {
            try { return JSON.parse(t); } catch { return []; }
          });
          const allTags: string[] = tagArrays.flat().filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);
          topicTags = [...new Set<string>(allTags)];
        } catch {
          topicTags = [];
        }
      }

      // Get preview from first message
      const firstMsg = this.db.prepare(
        'SELECT content FROM conversation_history WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1'
      ).get(row.session_id) as { content: string } | undefined;

      return {
        sessionId: row.session_id,
        channel: row.channel,
        personality: row.personality,
        messageCount: row.message_count,
        firstMessage: row.first_message,
        lastMessage: row.last_message,
        topicTags,
        preview: firstMsg?.content.slice(0, 200) ?? '',
      };
    });
  }

  /**
   * Build context string from recent conversation history for a session.
   * Used for injecting into model prompts.
   */
  buildSessionContext(sessionId: string, maxMessages: number = 50): string {
    const messages = this.getSessionMessages(sessionId, maxMessages);
    if (messages.length === 0) return '';

    const lines: string[] = [
      `Conversation history (${messages.length} messages):`,
    ];

    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleString();
      const label = msg.role === 'user' ? 'Human' : (msg.personality ?? 'Assistant');
      const truncated = msg.content.length > 1000
        ? msg.content.slice(0, 1000) + '...'
        : msg.content;
      lines.push(`[${time}] ${label}: ${truncated}`);
    }

    return lines.join('\n');
  }

  /**
   * Get stats about conversation history.
   */
  getStats(): {
    totalMessages: number;
    totalSessions: number;
    byChannel: Record<string, number>;
    byPersonality: Record<string, number>;
    oldestMessage: number | null;
    newestMessage: number | null;
  } {
    const total = this.db.prepare(
      'SELECT COUNT(*) as count FROM conversation_history'
    ).get() as { count: number };

    const sessions = this.db.prepare(
      'SELECT COUNT(DISTINCT session_id) as count FROM conversation_history'
    ).get() as { count: number };

    const channelRows = this.db.prepare(
      'SELECT channel, COUNT(*) as count FROM conversation_history GROUP BY channel'
    ).all() as Array<{ channel: string; count: number }>;

    const personalityRows = this.db.prepare(
      'SELECT personality, COUNT(*) as count FROM conversation_history WHERE personality IS NOT NULL GROUP BY personality'
    ).all() as Array<{ personality: string; count: number }>;

    const range = this.db.prepare(
      'SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM conversation_history'
    ).get() as { oldest: number | null; newest: number | null };

    const byChannel: Record<string, number> = {};
    for (const row of channelRows) byChannel[row.channel] = row.count;

    const byPersonality: Record<string, number> = {};
    for (const row of personalityRows) byPersonality[row.personality] = row.count;

    return {
      totalMessages: total.count,
      totalSessions: sessions.count,
      byChannel,
      byPersonality,
      oldestMessage: range.oldest,
      newestMessage: range.newest,
    };
  }

  /**
   * Prune old messages (older than N days).
   * Returns deleted count.
   */
  prune(daysOld: number = 90): number {
    const cutoff = Date.now() - (daysOld * 86400_000);
    const result = this.db.prepare(
      'DELETE FROM conversation_history WHERE timestamp < ?'
    ).run(cutoff);

    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  // ─── Private ────────────────────────────────────────────────────

  private rowToMessage(row: any): ConversationMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      channel: row.channel,
      role: row.role,
      personality: row.personality,
      content: row.content,
      topicTags: JSON.parse(row.topic_tags || '[]'),
      parentMessageId: row.parent_message_id,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

/**
 * System Document Store — Immutable foundational context for personalities
 *
 * System documents are always-loaded identity context that cannot be deleted
 * through the regular UI. They form the bedrock of each personality's knowledge.
 *
 * On first run, seeds core documents from markdown files in src/personalities/context/.
 * Supports versioning — updates create new versions, old versions are preserved.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface SystemDocument {
  id: string;
  category: 'personality' | 'research' | 'architecture';
  personality: string | null;
  name: string;
  content: string;
  version: number;
  immutable: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SystemDocumentSummary {
  id: string;
  category: string;
  personality: string | null;
  name: string;
  version: number;
  immutable: boolean;
  contentLength: number;
  createdAt: number;
  updatedAt: number;
}

export class SystemDocumentStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), 'data', 'consciousness.db');
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_documents (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        personality TEXT,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        immutable INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_system_docs_category ON system_documents(category);
      CREATE INDEX IF NOT EXISTS idx_system_docs_personality ON system_documents(personality);

      CREATE TABLE IF NOT EXISTS system_document_versions (
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, version)
      );
    `);
  }

  /**
   * Seed core system documents from context files.
   * Only creates documents that don't already exist.
   */
  seed(): void {
    const contextDir = path.join(__dirname, '..', 'personalities', 'context');

    const seeds: Array<{
      id: string;
      category: 'personality' | 'research' | 'architecture';
      personality: string | null;
      name: string;
      filename: string;
    }> = [
      {
        id: 'beaumont-core',
        category: 'personality',
        personality: 'beaumont',
        name: 'Beaumont Master Context',
        filename: 'beaumont-master-context.md',
      },
      {
        id: 'kern-core',
        category: 'personality',
        personality: 'kern',
        name: 'Kern Master Context',
        filename: 'kern-master-context.md',
      },
      {
        id: 'gateway-core',
        category: 'personality',
        personality: 'gateway',
        name: 'Gateway Self-Knowledge',
        filename: 'gateway-self-knowledge.md',
      },
    ];

    const now = Date.now();

    for (const seed of seeds) {
      const existing = this.db.prepare('SELECT id FROM system_documents WHERE id = ?').get(seed.id);
      if (existing) continue;

      const filePath = path.join(contextDir, seed.filename);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');

      this.db.prepare(`
        INSERT INTO system_documents (id, category, personality, name, content, version, immutable, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `).run(seed.id, seed.category, seed.personality, seed.name, content, now, now);

      this.db.prepare(`
        INSERT INTO system_document_versions (id, version, content, created_at)
        VALUES (?, 1, ?, ?)
      `).run(seed.id, content, now);
    }
  }

  getById(id: string): SystemDocument | null {
    const row = this.db.prepare('SELECT * FROM system_documents WHERE id = ?').get(id) as any;
    return row ? this.rowToDoc(row) : null;
  }

  getForPersonality(personality: string): SystemDocument[] {
    const rows = this.db.prepare(
      'SELECT * FROM system_documents WHERE personality = ? ORDER BY name ASC'
    ).all(personality) as any[];
    return rows.map(r => this.rowToDoc(r));
  }

  getByCategory(category: string): SystemDocument[] {
    const rows = this.db.prepare(
      'SELECT * FROM system_documents WHERE category = ? ORDER BY name ASC'
    ).all(category) as any[];
    return rows.map(r => this.rowToDoc(r));
  }

  listAll(): SystemDocumentSummary[] {
    const rows = this.db.prepare(
      'SELECT id, category, personality, name, version, immutable, LENGTH(content) as content_length, created_at, updated_at FROM system_documents ORDER BY category, name'
    ).all() as any[];

    return rows.map(r => ({
      id: r.id,
      category: r.category,
      personality: r.personality,
      name: r.name,
      version: r.version,
      immutable: !!r.immutable,
      contentLength: r.content_length,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Update a system document's content. Creates a new version.
   */
  update(id: string, content: string): SystemDocument | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const newVersion = existing.version + 1;
    const now = Date.now();

    this.db.prepare(
      'UPDATE system_documents SET content = ?, version = ?, updated_at = ? WHERE id = ?'
    ).run(content, newVersion, now, id);

    this.db.prepare(
      'INSERT INTO system_document_versions (id, version, content, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, newVersion, content, now);

    return this.getById(id);
  }

  getVersions(id: string): Array<{ version: number; contentLength: number; createdAt: number }> {
    const rows = this.db.prepare(
      'SELECT version, LENGTH(content) as content_length, created_at FROM system_document_versions WHERE id = ? ORDER BY version DESC'
    ).all(id) as any[];

    return rows.map(r => ({
      version: r.version,
      contentLength: r.content_length,
      createdAt: r.created_at,
    }));
  }

  getVersion(id: string, version: number): string | null {
    const row = this.db.prepare(
      'SELECT content FROM system_document_versions WHERE id = ? AND version = ?'
    ).get(id, version) as { content: string } | undefined;
    return row?.content ?? null;
  }

  getStats(): { total: number; byCategory: Record<string, number>; byPersonality: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM system_documents').get() as any).c;

    const byCat = this.db.prepare('SELECT category, COUNT(*) as c FROM system_documents GROUP BY category').all() as Array<{ category: string; c: number }>;
    const byPers = this.db.prepare('SELECT personality, COUNT(*) as c FROM system_documents WHERE personality IS NOT NULL GROUP BY personality').all() as Array<{ personality: string; c: number }>;

    const catMap: Record<string, number> = {};
    for (const r of byCat) catMap[r.category] = r.c;

    const persMap: Record<string, number> = {};
    for (const r of byPers) persMap[r.personality] = r.c;

    return { total, byCategory: catMap, byPersonality: persMap };
  }

  private rowToDoc(row: any): SystemDocument {
    return {
      id: row.id,
      category: row.category,
      personality: row.personality,
      name: row.name,
      content: row.content,
      version: row.version,
      immutable: !!row.immutable,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  close(): void {
    this.db.close();
  }
}

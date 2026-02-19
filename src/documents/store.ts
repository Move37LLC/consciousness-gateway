/**
 * Document Store — SQLite persistence + file processing for the knowledge base
 *
 * Handles:
 * - Schema migration in consciousness.db
 * - Text extraction from PDF, DOCX, HTML, TXT, MD
 * - Keyword extraction for auto-tagging
 * - CRUD operations with versioning
 * - Original file storage in data/documents/
 * - ZIP export by project
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import {
  Document, DocumentSummary, DocumentMetadata, ProjectId,
  UploadOptions, SUPPORTED_MIME_TYPES, VALID_PROJECTS, MAX_FILE_SIZE,
} from './types';

export class DocumentStore {
  private db: Database.Database;
  private filesDir: string;

  constructor(dbPath?: string, filesDir?: string) {
    const resolvedDb = dbPath ?? path.join(process.cwd(), 'data', 'consciousness.db');
    this.filesDir = filesDir ?? path.join(process.cwd(), 'data', 'documents');

    if (!fs.existsSync(this.filesDir)) {
      fs.mkdirSync(this.filesDir, { recursive: true });
    }

    this.db = new Database(resolvedDb);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        uploaded_at INTEGER NOT NULL,
        tags TEXT,
        version INTEGER DEFAULT 1,
        parent_id TEXT,
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project);
      CREATE INDEX IF NOT EXISTS idx_documents_uploaded ON documents(uploaded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
    `);
  }

  // ─── File Processing ─────────────────────────────────────────────

  async extractText(buffer: Buffer, filename: string): Promise<string> {
    const ext = path.extname(filename).toLowerCase();

    switch (ext) {
      case '.txt':
      case '.md':
        return buffer.toString('utf-8');

      case '.pdf':
        return await this.extractPdf(buffer);

      case '.docx':
        return await this.extractDocx(buffer);

      case '.html':
      case '.htm':
        return this.extractHtml(buffer.toString('utf-8'));

      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    // pdf-parse v2 has complex CJS/ESM exports; use require for compatibility
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('pdf-parse');
    const result = await pdfParse(buffer);
    return result.text;
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth') as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  private extractHtml(html: string): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
    text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n');
    return text.trim();
  }

  // ─── Keyword Extraction ──────────────────────────────────────────

  extractKeywords(text: string, count: number = 10): string[] {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w));

    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([word]) => word);
  }

  // ─── CRUD Operations ─────────────────────────────────────────────

  async upload(
    buffer: Buffer,
    filename: string,
    options: UploadOptions,
  ): Promise<Document> {
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_MIME_TYPES[ext]) {
      throw new Error(`Unsupported file type: ${ext}. Supported: ${Object.keys(SUPPORTED_MIME_TYPES).join(', ')}`);
    }

    if (!VALID_PROJECTS.includes(options.project)) {
      throw new Error(`Invalid project: ${options.project}. Valid: ${VALID_PROJECTS.join(', ')}`);
    }

    const content = await this.extractText(buffer, filename);
    const id = uuid();
    const mimeType = SUPPORTED_MIME_TYPES[ext];
    const tags = options.tags?.length ? options.tags : this.extractKeywords(content);
    const now = Date.now();

    // Determine version
    let version = 1;
    if (options.parentId) {
      const parent = this.getById(options.parentId);
      if (parent) {
        version = parent.version + 1;
      }
    }

    const metadata: DocumentMetadata = {
      description: options.description,
    };

    this.db.prepare(`
      INSERT INTO documents (id, project, filename, content, mime_type, size_bytes, uploaded_at, tags, version, parent_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, options.project, filename, content, mimeType,
      buffer.length, now, JSON.stringify(tags), version,
      options.parentId ?? null, JSON.stringify(metadata),
    );

    // Save original file
    const filePath = path.join(this.filesDir, `${id}${ext}`);
    fs.writeFileSync(filePath, buffer);

    return {
      id, project: options.project, filename, content, mimeType,
      sizeBytes: buffer.length, uploadedAt: now, tags, version,
      parentId: options.parentId ?? null, metadata,
    };
  }

  getById(id: string): Document | null {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    return row ? this.rowToDocument(row) : null;
  }

  list(filters?: { project?: string; tags?: string[]; search?: string }): DocumentSummary[] {
    let sql = 'SELECT id, project, filename, mime_type, size_bytes, uploaded_at, tags, version, metadata FROM documents';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.project) {
      conditions.push('project = ?');
      params.push(filters.project);
    }

    if (filters?.tags?.length) {
      for (const tag of filters.tags) {
        conditions.push('tags LIKE ?');
        params.push(`%"${tag}"%`);
      }
    }

    if (filters?.search) {
      conditions.push('(filename LIKE ? OR content LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY uploaded_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      project: r.project,
      filename: r.filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      uploadedAt: r.uploaded_at,
      tags: JSON.parse(r.tags || '[]'),
      version: r.version,
      description: JSON.parse(r.metadata || '{}').description,
    }));
  }

  update(id: string, updates: { tags?: string[]; description?: string }): Document | null {
    const doc = this.getById(id);
    if (!doc) return null;

    if (updates.tags) {
      this.db.prepare('UPDATE documents SET tags = ? WHERE id = ?')
        .run(JSON.stringify(updates.tags), id);
    }

    if (updates.description !== undefined) {
      const meta = { ...doc.metadata, description: updates.description };
      this.db.prepare('UPDATE documents SET metadata = ? WHERE id = ?')
        .run(JSON.stringify(meta), id);
    }

    return this.getById(id);
  }

  delete(id: string): boolean {
    const doc = this.getById(id);
    if (!doc) return false;

    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);

    // Remove stored file
    const ext = path.extname(doc.filename).toLowerCase();
    const filePath = path.join(this.filesDir, `${id}${ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return true;
  }

  getOriginalFilePath(id: string): string | null {
    const doc = this.getById(id);
    if (!doc) return null;

    const ext = path.extname(doc.filename).toLowerCase();
    const filePath = path.join(this.filesDir, `${id}${ext}`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  /**
   * Get documents relevant to a personality + message context.
   * Used for automatic context injection.
   */
  getRelevantDocuments(
    personality: string,
    message: string,
    limit: number = 3,
  ): Document[] {
    const projectMap: Record<string, ProjectId[]> = {
      beaumont: ['research', 'general'],
      kern: ['gateway', 'general'],
      gateway: ['gateway', 'research', 'general'],
    };

    const projects = projectMap[personality] ?? ['general'];

    // Check if message explicitly mentions a project
    for (const p of VALID_PROJECTS) {
      if (message.toLowerCase().includes(p)) {
        if (!projects.includes(p)) projects.unshift(p);
      }
    }

    const placeholders = projects.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT * FROM documents WHERE project IN (${placeholders}) ORDER BY uploaded_at DESC LIMIT ?`
    ).all(...projects, limit) as any[];

    return rows.map(r => this.rowToDocument(r));
  }

  getStats(): { total: number; byProject: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
    const byProject = this.db.prepare(
      'SELECT project, COUNT(*) as c FROM documents GROUP BY project'
    ).all() as Array<{ project: string; c: number }>;

    const projectCounts: Record<string, number> = {};
    for (const row of byProject) {
      projectCounts[row.project] = row.c;
    }

    return { total, byProject: projectCounts };
  }

  // ─── ZIP Export ──────────────────────────────────────────────────

  async exportProject(project: ProjectId): Promise<Buffer> {
    const archiver = (await import('archiver')).default;
    const docs = this.list({ project });

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Add each document's original file or text content
      for (const doc of docs) {
        const filePath = this.getOriginalFilePath(doc.id);
        if (filePath) {
          archive.file(filePath, { name: doc.filename });
        } else {
          const full = this.getById(doc.id);
          if (full) {
            archive.append(full.content, { name: doc.filename });
          }
        }
      }

      // Add metadata.json
      const metadata = docs.map(d => ({
        filename: d.filename,
        project: d.project,
        tags: d.tags,
        uploadedAt: new Date(d.uploadedAt).toISOString(),
        sizeBytes: d.sizeBytes,
        version: d.version,
        description: d.description,
      }));
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      archive.finalize();
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private rowToDocument(row: any): Document {
    return {
      id: row.id,
      project: row.project,
      filename: row.filename,
      content: row.content,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadedAt: row.uploaded_at,
      tags: JSON.parse(row.tags || '[]'),
      version: row.version,
      parentId: row.parent_id,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }

  close(): void {
    this.db.close();
  }
}

// ─── Stop Words ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from',
  'with', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'not', 'also', 'very', 'often', 'however', 'too', 'usually',
  'really', 'already', 'although', 'much', 'more', 'most', 'other', 'some', 'such',
  'than', 'then', 'just', 'about', 'over', 'only', 'into', 'which', 'their',
  'there', 'they', 'them', 'what', 'when', 'where', 'who', 'whom', 'your', 'each',
  'every', 'both', 'many', 'here', 'because', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'again', 'further', 'once',
  'while', 'same', 'down', 'like', 'well', 'back', 'even', 'still', 'make',
  'made', 'take', 'come', 'know', 'think', 'said', 'work', 'call', 'first',
  'long', 'look', 'way', 'find', 'give', 'tell', 'help', 'show', 'keep',
]);

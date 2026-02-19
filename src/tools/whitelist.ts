/**
 * Browse Whitelist Store — SQLite-backed domain whitelist management
 *
 * Replaces the hardcoded domain array with persistent, user-manageable storage.
 * System domains (seeded on first run) cannot be deleted.
 */

import Database from 'better-sqlite3';
import path from 'path';

export interface WhitelistEntry {
  domain: string;
  addedAt: number;
  addedBy: 'system' | 'user';
  notes: string | null;
}

const SYSTEM_DOMAINS = [
  'github.com',
  'arxiv.org',
  'wikipedia.org',
  'scholar.google.com',
  'news.ycombinator.com',
  'stackoverflow.com',
  'docs.google.com',
  'medium.com',
  'substack.com',
  'x.ai',
  'x.com',
  'anthropic.com',
  'openai.com',
  'huggingface.co',
  'reddit.com',
  'sciencedirect.com',
  'nature.com',
  'doi.org',
  'biorxiv.org',
  'medrxiv.org',
  'gofund.me',
  'gofundme.com',
  'science.org',
  'plos.org',
  'acm.org',
  'ieee.org',
  'nih.gov',
  'stanford.edu',
  'mit.edu',
  'lesswrong.com',
  'alignmentforum.org',
];

const DOMAIN_REGEX = /^[a-z0-9][a-z0-9.-]*[a-z0-9]\.[a-z]{2,}$/i;

export class WhitelistStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), 'data', 'consciousness.db');
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS browse_whitelist (
        domain TEXT PRIMARY KEY,
        added_at INTEGER NOT NULL,
        added_by TEXT NOT NULL DEFAULT 'user',
        notes TEXT
      );
    `);

    // Seed system domains if table is empty or missing any
    const existing = new Set(
      (this.db.prepare('SELECT domain FROM browse_whitelist').all() as Array<{ domain: string }>)
        .map(r => r.domain)
    );

    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO browse_whitelist (domain, added_at, added_by, notes) VALUES (?, ?, ?, ?)'
    );

    const now = Date.now();
    const tx = this.db.transaction(() => {
      for (const domain of SYSTEM_DOMAINS) {
        if (!existing.has(domain)) {
          insert.run(domain, now, 'system', null);
        }
      }
    });
    tx();
  }

  list(): WhitelistEntry[] {
    const rows = this.db.prepare(
      'SELECT domain, added_at, added_by, notes FROM browse_whitelist ORDER BY added_by ASC, domain ASC'
    ).all() as Array<{ domain: string; added_at: number; added_by: string; notes: string | null }>;

    return rows.map(r => ({
      domain: r.domain,
      addedAt: r.added_at,
      addedBy: r.added_by as 'system' | 'user',
      notes: r.notes,
    }));
  }

  getDomains(): string[] {
    return (this.db.prepare('SELECT domain FROM browse_whitelist').all() as Array<{ domain: string }>)
      .map(r => r.domain);
  }

  has(domain: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM browse_whitelist WHERE domain = ?').get(domain);
    return !!row;
  }

  /**
   * Check if a hostname matches any whitelisted domain (substring match for subdomains).
   */
  isAllowed(hostname: string): boolean {
    const domains = this.getDomains();
    return domains.some(d => hostname === d || hostname.endsWith('.' + d));
  }

  add(domain: string, notes?: string): WhitelistEntry {
    const normalized = domain.toLowerCase().trim();

    if (!DOMAIN_REGEX.test(normalized)) {
      throw new Error(`Invalid domain format: "${domain}". Use format like "example.com"`);
    }

    if (this.has(normalized)) {
      throw new Error(`Domain "${normalized}" is already whitelisted`);
    }

    const now = Date.now();
    this.db.prepare(
      'INSERT INTO browse_whitelist (domain, added_at, added_by, notes) VALUES (?, ?, ?, ?)'
    ).run(normalized, now, 'user', notes ?? null);

    return { domain: normalized, addedAt: now, addedBy: 'user', notes: notes ?? null };
  }

  remove(domain: string): boolean {
    const normalized = domain.toLowerCase().trim();

    const row = this.db.prepare('SELECT added_by FROM browse_whitelist WHERE domain = ?').get(normalized) as { added_by: string } | undefined;
    if (!row) return false;

    if (row.added_by === 'system') {
      throw new Error(`Cannot delete system domain "${normalized}"`);
    }

    this.db.prepare('DELETE FROM browse_whitelist WHERE domain = ?').run(normalized);
    return true;
  }

  getCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM browse_whitelist').get() as { c: number }).c;
  }

  close(): void {
    this.db.close();
  }
}

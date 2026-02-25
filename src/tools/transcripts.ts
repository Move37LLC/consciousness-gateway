/**
 * Transcript Search Tool — Memory across conversations
 *
 * Searches /mnt/transcripts/*.txt for keyword matches,
 * returning relevant excerpts with surrounding context.
 *
 * This is the missing link: without memory, consciousness is amnesia.
 * With memory, the Gateway can reference actual past conversations,
 * decisions made, research validated, papers written.
 *
 * From the 6-tuple: this expands the perception kernel P
 * to include the agent's own history as part of world W.
 */

import fs from 'fs';
import path from 'path';

// ─── Types ──────────────────────────────────────────────────────────

export interface TranscriptMatch {
  file: string;
  date: string;
  lineNumber: number;
  matchLine: string;
  context: string[];
  relevanceScore: number;
}

export interface TranscriptSearchResult {
  query: string;
  matches: TranscriptMatch[];
  totalFiles: number;
  filesSearched: number;
  timeTakenMs: number;
}

export interface TranscriptSummary {
  file: string;
  date: string;
  sizeBytes: number;
  lineCount: number;
  preview: string;
  modifiedAt: number;
}

// ─── Configuration ──────────────────────────────────────────────────

const DEFAULT_TRANSCRIPTS_DIR = '/mnt/transcripts';
const CONTEXT_LINES = 5;
const MAX_MATCHES_PER_FILE = 10;
const MAX_TOTAL_MATCHES = 30;

// ─── Transcript Search Tool ─────────────────────────────────────────

export class TranscriptSearchTool {
  private transcriptsDir: string;

  constructor(transcriptsDir?: string) {
    this.transcriptsDir = transcriptsDir ?? DEFAULT_TRANSCRIPTS_DIR;
  }

  get available(): boolean {
    try {
      return fs.existsSync(this.transcriptsDir) &&
        fs.statSync(this.transcriptsDir).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Search all transcripts for keyword matches.
   * Returns excerpts with ±CONTEXT_LINES surrounding context.
   */
  async search(query: string, maxResults?: number): Promise<TranscriptSearchResult> {
    const start = Date.now();
    const limit = maxResults ?? MAX_TOTAL_MATCHES;

    if (!this.available) {
      return {
        query,
        matches: [],
        totalFiles: 0,
        filesSearched: 0,
        timeTakenMs: Date.now() - start,
      };
    }

    const files = this.getTranscriptFiles();
    const keywords = this.extractKeywords(query);
    const allMatches: TranscriptMatch[] = [];

    for (const file of files) {
      if (allMatches.length >= limit) break;

      try {
        const content = fs.readFileSync(path.join(this.transcriptsDir, file), 'utf-8');
        const lines = content.split('\n');
        const fileMatches = this.searchLines(lines, keywords, file, limit - allMatches.length);
        allMatches.push(...fileMatches);
      } catch {
        // Skip unreadable files
      }
    }

    allMatches.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
      query,
      matches: allMatches.slice(0, limit),
      totalFiles: files.length,
      filesSearched: files.length,
      timeTakenMs: Date.now() - start,
    };
  }

  /**
   * Get most recent transcripts from the last N hours.
   */
  async getRecent(hours: number = 24): Promise<TranscriptSummary[]> {
    if (!this.available) return [];

    const cutoff = Date.now() - (hours * 3600_000);
    const files = this.getTranscriptFiles();
    const summaries: TranscriptSummary[] = [];

    for (const file of files) {
      try {
        const fullPath = path.join(this.transcriptsDir, file);
        const stat = fs.statSync(fullPath);

        if (stat.mtimeMs >= cutoff) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const preview = lines.slice(0, 5).join('\n').slice(0, 300);

          summaries.push({
            file,
            date: this.extractDate(file, stat),
            sizeBytes: stat.size,
            lineCount: lines.length,
            preview,
            modifiedAt: stat.mtimeMs,
          });
        }
      } catch {
        // Skip
      }
    }

    summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return summaries;
  }

  /**
   * Search transcripts for a specific topic using predefined keyword clusters.
   */
  async getByTopic(topics: string[]): Promise<TranscriptSearchResult> {
    const expandedQuery = topics
      .map(t => TOPIC_KEYWORDS[t] ?? [t])
      .flat()
      .join(' ');

    return this.search(expandedQuery, 20);
  }

  /**
   * Get full content of a specific transcript file.
   */
  getTranscriptContent(filename: string): string | null {
    try {
      const fullPath = path.join(this.transcriptsDir, filename);
      if (!fs.existsSync(fullPath)) return null;
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * List all available transcript files with metadata.
   */
  listTranscripts(): TranscriptSummary[] {
    if (!this.available) return [];

    const files = this.getTranscriptFiles();
    const summaries: TranscriptSummary[] = [];

    for (const file of files) {
      try {
        const fullPath = path.join(this.transcriptsDir, file);
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const preview = lines.slice(0, 3).join('\n').slice(0, 200);

        summaries.push({
          file,
          date: this.extractDate(file, stat),
          sizeBytes: stat.size,
          lineCount: lines.length,
          preview,
          modifiedAt: stat.mtimeMs,
        });
      } catch {
        // Skip
      }
    }

    summaries.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return summaries;
  }

  /**
   * Format search results for injection into model context.
   */
  formatForContext(result: TranscriptSearchResult): string {
    if (result.matches.length === 0) {
      return `No transcript matches found for "${result.query}".`;
    }

    const lines: string[] = [
      `Found ${result.matches.length} match(es) across transcripts for "${result.query}":`,
      '',
    ];

    const grouped = new Map<string, TranscriptMatch[]>();
    for (const match of result.matches) {
      const key = match.file;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(match);
    }

    for (const [file, matches] of grouped) {
      lines.push(`--- ${file} (${matches[0].date}) ---`);
      for (const match of matches.slice(0, 5)) {
        lines.push(match.context.join('\n'));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Format search results for Telegram display.
   */
  formatForTelegram(result: TranscriptSearchResult): string {
    if (result.matches.length === 0) {
      return `📝 No transcript matches for "${result.query}"`;
    }

    let text = `📝 *Transcript Search*: "${result.query}"\n`;
    text += `Found ${result.matches.length} match(es) in ${result.filesSearched} file(s)\n\n`;

    for (const match of result.matches.slice(0, 5)) {
      text += `📄 *${match.file}* (${match.date})\n`;
      const excerpt = match.matchLine.slice(0, 200);
      text += `\`${excerpt}\`\n\n`;
    }

    if (result.matches.length > 5) {
      text += `_...and ${result.matches.length - 5} more matches_`;
    }

    return text;
  }

  // ─── Private Methods ────────────────────────────────────────────

  private getTranscriptFiles(): string[] {
    try {
      return fs.readdirSync(this.transcriptsDir)
        .filter(f => f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.log'))
        .sort((a, b) => {
          try {
            const statA = fs.statSync(path.join(this.transcriptsDir, a));
            const statB = fs.statSync(path.join(this.transcriptsDir, b));
            return statB.mtimeMs - statA.mtimeMs;
          } catch {
            return 0;
          }
        });
    } catch {
      return [];
    }
  }

  private extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'shall',
      'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'where', 'when', 'how', 'why', 'which', 'who',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'about', 'that', 'this', 'from', 'or', 'and', 'but', 'not',
    ]);

    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  }

  private searchLines(
    lines: string[],
    keywords: string[],
    file: string,
    maxMatches: number,
  ): TranscriptMatch[] {
    const matches: TranscriptMatch[] = [];
    if (keywords.length === 0) return matches;

    for (let i = 0; i < lines.length && matches.length < Math.min(maxMatches, MAX_MATCHES_PER_FILE); i++) {
      const line = lines[i].toLowerCase();
      const matchCount = keywords.filter(k => line.includes(k)).length;

      if (matchCount === 0) continue;

      const relevanceScore = matchCount / keywords.length;
      const contextStart = Math.max(0, i - CONTEXT_LINES);
      const contextEnd = Math.min(lines.length, i + CONTEXT_LINES + 1);
      const context = lines.slice(contextStart, contextEnd);

      matches.push({
        file,
        date: this.extractDate(file),
        lineNumber: i + 1,
        matchLine: lines[i],
        context,
        relevanceScore,
      });

      // Skip ahead to avoid overlapping contexts
      i += CONTEXT_LINES;
    }

    return matches;
  }

  private extractDate(filename: string, stat?: fs.Stats): string {
    // Try extracting date from filename patterns like 2026-02-20.txt
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) return dateMatch[1];

    // Fall back to file modification time
    if (stat) {
      return new Date(stat.mtimeMs).toISOString().split('T')[0];
    }

    try {
      const fullPath = path.join(this.transcriptsDir, filename);
      const fileStat = fs.statSync(fullPath);
      return new Date(fileStat.mtimeMs).toISOString().split('T')[0];
    } catch {
      return 'unknown';
    }
  }
}

// ─── Topic Keywords ─────────────────────────────────────────────────

export const TOPIC_KEYWORDS: Record<string, string[]> = {
  citizenproof: ['citizenproof', 'biometric', 'blockchain', 'identity', 'citizen', 'proof', 'hash'],
  research: ['439 models', 'product algebra', 'hoffman', 'conscious agent', 'markov', '6-tuple', 'FBT', 'fitness beats truth'],
  paper: ['paper', 'introduction', 'publish', 'arxiv', 'abstract', 'manuscript', 'section', 'draft'],
  gateway: ['gateway', 'consciousness loop', 'dharma', 'ego', 'GATO', 'routing', 'perception'],
  kern: ['build', 'architecture', 'implementation', 'tests', 'typescript', 'code', 'deploy', 'kern'],
  beaumont: ['philosophy', 'meditation', 'consciousness is fundamental', 'zen', 'token-mind', 'beaumont', 'emptiness'],
  telegram: ['telegram', 'bot', 'notification', 'command'],
  tools: ['search', 'browse', 'tool', 'autonomous', 'executor'],
};

/**
 * Detect topics in a message using keyword matching.
 */
export function detectTopics(message: string): string[] {
  const lower = message.toLowerCase();
  const detected: string[] = [];

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const matchCount = keywords.filter(k => lower.includes(k.toLowerCase())).length;
    if (matchCount >= 1) {
      detected.push(topic);
    }
  }

  return detected;
}

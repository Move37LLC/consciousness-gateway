/**
 * Transcript Exporter — close the SQLite → file gap
 *
 * ConversationStore writes every message to `conversation_history`.
 * TranscriptSearchTool only reads `.txt` / `.md` / `.log` files from
 * TRANSCRIPTS_DIR. Nothing previously bridged the two — so on macOS,
 * with no `/mnt/transcripts` and no writer, `[TRANSCRIPT:]` was dead.
 *
 * This exporter dumps sessions into searchable text files the existing
 * search tool already understands. Trading channel is excluded by
 * default (high volume, low conversational value for identity recall).
 */

import fs from 'fs';
import path from 'path';
import { ConversationStore, ConversationMessage } from '../memory/conversation-store';

export interface TranscriptExportOptions {
  /** Destination directory (created if missing). */
  outDir: string;
  /** Channels to skip. Default: ['trading']. */
  excludeChannels?: string[];
  /** Skip sessions shorter than this. Default: 2. */
  minMessages?: number;
  /** Max sessions to export (newest first). Default: 5000. */
  maxSessions?: number;
}

export interface TranscriptExportResult {
  outDir: string;
  filesWritten: number;
  sessionsExported: number;
  sessionsSkipped: number;
  messagesExported: number;
  excludedChannels: string[];
}

/**
 * Export conversation_history sessions into TRANSCRIPTS_DIR-compatible files.
 * Filenames: `YYYY-MM-DD_<channel>_<sessionShort>.txt`
 */
export function exportConversationsToTranscripts(
  store: ConversationStore,
  options: TranscriptExportOptions,
): TranscriptExportResult {
  const outDir = options.outDir;
  const excludeChannels = options.excludeChannels ?? ['trading'];
  const minMessages = options.minMessages ?? 2;
  const maxSessions = options.maxSessions ?? 5000;

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const sessions = store.getSessions({ limit: maxSessions });
  let filesWritten = 0;
  let sessionsExported = 0;
  let sessionsSkipped = 0;
  let messagesExported = 0;

  for (const session of sessions) {
    if (excludeChannels.includes(session.channel)) {
      sessionsSkipped++;
      continue;
    }
    if (session.messageCount < minMessages) {
      sessionsSkipped++;
      continue;
    }

    const messages = store.getSessionMessages(session.sessionId, 500);
    if (messages.length < minMessages) {
      sessionsSkipped++;
      continue;
    }

    const body = formatSessionTranscript(session.sessionId, session.channel, messages);
    const date = isoDate(session.firstMessage);
    const shortId = session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filename = `${date}_${session.channel}_${shortId}.txt`;
    const fullPath = path.join(outDir, filename);

    fs.writeFileSync(fullPath, body, 'utf-8');
    filesWritten++;
    sessionsExported++;
    messagesExported += messages.length;
  }

  return {
    outDir,
    filesWritten,
    sessionsExported,
    sessionsSkipped,
    messagesExported,
    excludedChannels: excludeChannels,
  };
}

function formatSessionTranscript(
  sessionId: string,
  channel: string,
  messages: ConversationMessage[],
): string {
  const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const lines: string[] = [
    `Session: ${sessionId}`,
    `Channel: ${channel}`,
    `Messages: ${sorted.length}`,
    `Range: ${new Date(sorted[0].timestamp).toISOString()} → ${new Date(sorted[sorted.length - 1].timestamp).toISOString()}`,
    '',
    '─'.repeat(60),
    '',
  ];

  for (const m of sorted) {
    const when = new Date(m.timestamp).toISOString();
    const who = m.role === 'user'
      ? 'Human'
      : (m.personality ? `Assistant (${m.personality})` : 'Assistant');
    const tags = m.topicTags.length > 0 ? ` [${m.topicTags.join(', ')}]` : '';
    lines.push(`[${when}] ${who}${tags}:`);
    lines.push(m.content);
    lines.push('');
  }

  return lines.join('\n');
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Resolve the effective transcripts directory (env or Linux default). */
export function resolveTranscriptsDir(envValue?: string): string {
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : '/mnt/transcripts';
}

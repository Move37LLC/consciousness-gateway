/**
 * Intelligent Context Builder — Memory-aware context injection
 *
 * Before every request, this module detects topics in the user's message,
 * loads relevant transcripts, retrieves conversation history, and builds
 * comprehensive context that gives the Gateway actual memory.
 *
 * The order of context injection:
 *   1. Relevant past conversations (transcripts)
 *   2. Recent conversation history (current session)
 *   3. System documents (foundational identity)
 *   4. Consciousness state
 *   5. User documents (project files)
 *
 * This is how perception kernel P expands:
 *   P_limited: W → X_text (just the current message)
 *   P_enriched: W × History × Transcripts → X_rich (full memory)
 */

import { TranscriptSearchTool, detectTopics } from '../tools/transcripts';
import { ConversationStore, ConversationMessage } from './conversation-store';

// ─── Types ──────────────────────────────────────────────────────────

export interface ContextBuildOptions {
  sessionId: string;
  channel: string;
  personality?: string;
  maxTranscriptMatches?: number;
  maxHistoryMessages?: number;
  includeTranscripts?: boolean;
  includeHistory?: boolean;
}

export interface BuiltContext {
  transcriptSection: string;
  historySection: string;
  detectedTopics: string[];
  transcriptMatchCount: number;
  historyMessageCount: number;
}

// ─── Context Builder ────────────────────────────────────────────────

export class ContextBuilder {
  private transcripts: TranscriptSearchTool;
  private conversations: ConversationStore;

  constructor(transcripts: TranscriptSearchTool, conversations: ConversationStore) {
    this.transcripts = transcripts;
    this.conversations = conversations;
  }

  /**
   * Build memory-enriched context for a user message.
   * Detects topics, searches transcripts, loads history.
   */
  async buildContext(
    message: string,
    options: ContextBuildOptions,
  ): Promise<BuiltContext> {
    const topics = detectTopics(message);
    const maxTranscripts = options.maxTranscriptMatches ?? 15;
    const maxHistory = options.maxHistoryMessages ?? 50;

    // Search transcripts for relevant past conversations
    let transcriptSection = '';
    let transcriptMatchCount = 0;

    if (options.includeTranscripts !== false && this.transcripts.available) {
      if (topics.length > 0) {
        const topicResult = await this.transcripts.getByTopic(topics);
        if (topicResult.matches.length > 0) {
          transcriptSection = this.formatTranscriptContext(topicResult.matches.slice(0, maxTranscripts));
          transcriptMatchCount = topicResult.matches.length;
        }
      }

      // Also do a direct keyword search if the message has specific terms
      if (transcriptMatchCount < 5) {
        const directResult = await this.transcripts.search(message, maxTranscripts - transcriptMatchCount);
        if (directResult.matches.length > 0) {
          const directSection = this.formatTranscriptContext(directResult.matches);
          if (transcriptSection) {
            transcriptSection += '\n\n' + directSection;
          } else {
            transcriptSection = directSection;
          }
          transcriptMatchCount += directResult.matches.length;
        }
      }
    }

    // Load conversation history for current session
    let historySection = '';
    let historyMessageCount = 0;

    if (options.includeHistory !== false) {
      const history = this.conversations.getSessionMessages(options.sessionId, maxHistory);
      if (history.length > 0) {
        historySection = this.formatHistoryContext(history);
        historyMessageCount = history.length;
      }
    }

    return {
      transcriptSection,
      historySection,
      detectedTopics: topics,
      transcriptMatchCount,
      historyMessageCount,
    };
  }

  /**
   * Compose full context string from built context + other sections.
   */
  composeSystemPrompt(parts: {
    builtContext: BuiltContext;
    personalityPrompt?: string;
    consciousnessState?: string;
    documents?: string;
    toolPrompt?: string;
  }): string {
    const sections: string[] = [];

    // Personality prompt first (identity)
    if (parts.personalityPrompt) {
      sections.push(parts.personalityPrompt);
    }

    // Past conversations from transcripts
    if (parts.builtContext.transcriptSection) {
      sections.push(
        '─── RELEVANT PAST CONVERSATIONS ───',
        'These are excerpts from previous conversations. Use them to maintain continuity.',
        '',
        parts.builtContext.transcriptSection,
      );
    }

    // Recent conversation history
    if (parts.builtContext.historySection) {
      sections.push(
        '─── CONVERSATION HISTORY (Current Session) ───',
        parts.builtContext.historySection,
      );
    }

    // Consciousness state
    if (parts.consciousnessState) {
      sections.push(
        '─── CURRENT CONSCIOUSNESS STATE ───',
        parts.consciousnessState,
      );
    }

    // Documents
    if (parts.documents) {
      sections.push(
        '─── LOADED DOCUMENTS ───',
        parts.documents,
      );
    }

    // Tool instructions last
    if (parts.toolPrompt) {
      sections.push(parts.toolPrompt);
    }

    return sections.join('\n\n');
  }

  // ─── Private ────────────────────────────────────────────────────

  private formatTranscriptContext(matches: Array<{
    file: string;
    date: string;
    context: string[];
    matchLine: string;
  }>): string {
    const grouped = new Map<string, typeof matches>();
    for (const match of matches) {
      if (!grouped.has(match.file)) grouped.set(match.file, []);
      grouped.get(match.file)!.push(match);
    }

    const parts: string[] = [];
    for (const [file, fileMatches] of grouped) {
      parts.push(`[${fileMatches[0].date}] From ${file}:`);
      for (const m of fileMatches.slice(0, 3)) {
        parts.push(m.context.join('\n'));
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  private formatHistoryContext(messages: ConversationMessage[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleTimeString();
      const label = msg.role === 'user' ? 'Human' : (msg.personality ?? 'Assistant');
      const truncated = msg.content.length > 800
        ? msg.content.slice(0, 800) + '...'
        : msg.content;
      lines.push(`[${time}] ${label}: ${truncated}`);
    }

    return lines.join('\n');
  }
}

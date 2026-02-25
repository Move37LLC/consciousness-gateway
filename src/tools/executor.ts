/**
 * Autonomous Tool Executor — Parse-Execute-Reprompt Loop
 *
 * When a model response contains tool tags like [SEARCH: query] or [BROWSE: url],
 * this executor intercepts them, runs the tool, and feeds results back to the model
 * for a final synthesized response.
 *
 * Used by both /v1/chat (dashboard) and Telegram personality handlers.
 *
 * Safety: max iterations, rate limiting, domain whitelist, consciousness logging.
 */

import { WebSearchTool, SearchResponse } from './search';
import { WebBrowseTool, BrowseResult } from './browse';
import { TranscriptSearchTool } from './transcripts';

// ─── Types ──────────────────────────────────────────────────────────

export interface ToolResult {
  type: 'search' | 'browse' | 'transcript';
  query?: string;
  url?: string;
  data: string;
  timeTakenMs: number;
}

export interface ToolExecutionState {
  toolsUsed: ToolResult[];
  iterations: number;
  finalContent: string;
}

export interface ToolExecutorConfig {
  maxIterations?: number;
  maxToolCallsPerConversation?: number;
  onToolStart?: (type: string, target: string) => void;
  onToolComplete?: (result: ToolResult) => void;
  logEvent?: (summary: string, data?: Record<string, unknown>) => void;
}

type ModelCallFn = (prompt: string, systemPrompt?: string) => Promise<string>;

// ─── Tool Tag Patterns ──────────────────────────────────────────────

const SEARCH_TAG = /\[SEARCH:\s*(.+?)\]/;
const BROWSE_TAG = /\[BROWSE:\s*(.+?)\]/;
const TRANSCRIPT_TAG = /\[TRANSCRIPT:\s*(.+?)\]/;

// ─── System Prompt Fragment ─────────────────────────────────────────

export function buildToolSystemPrompt(
  searchAvailable: boolean,
  browseAvailable: boolean,
  transcriptAvailable: boolean = false,
): string {
  const tools: string[] = [];

  if (searchAvailable) {
    tools.push(
      '- [SEARCH: query] — Search the web via Brave Search API. Returns top results with titles, URLs, and snippets.',
    );
  }
  if (browseAvailable) {
    tools.push(
      '- [BROWSE: url] — Fetch and read a web page. Returns a summary of the page content. Only whitelisted domains allowed (GitHub, arXiv, Wikipedia, etc.).',
    );
  }
  if (transcriptAvailable) {
    tools.push(
      '- [TRANSCRIPT: query] — Search past conversation transcripts. Returns excerpts from previous conversations matching the query. Use this to recall past discussions, decisions, or research.',
    );
  }

  if (tools.length === 0) return '';

  return [
    '',
    '─── AVAILABLE TOOLS ───',
    'You can use the following tools when you need information not in your context or documents.',
    'To use a tool, include the exact tag in your response. The system will execute it and return results.',
    '',
    ...tools,
    '',
    'Usage rules:',
    '- Place the tool tag on its own line.',
    '- You may briefly explain why you are using the tool before the tag.',
    '- After the system returns results, synthesize them into a helpful response.',
    '- You can use multiple tools in sequence (one per response cycle).',
    '- Do NOT fabricate tool results. Wait for the system to provide them.',
    '',
    'Examples:',
    'User: "What are current Solana gas fees?"',
    'You: "Let me search for the latest data on that.\\n[SEARCH: solana gas fees 2026]"',
    '',
    'User: "Check our GitHub issues"',
    'You: "I\'ll look at the issues page.\\n[BROWSE: https://github.com/Move37LLC/consciousness-gateway/issues]"',
  ].join('\n');
}

// ─── Executor ───────────────────────────────────────────────────────

export class ToolExecutor {
  private searchTool: WebSearchTool;
  private browseTool: WebBrowseTool;
  private transcriptTool: TranscriptSearchTool | null;
  private config: Required<ToolExecutorConfig>;

  constructor(
    searchTool: WebSearchTool,
    browseTool: WebBrowseTool,
    config?: ToolExecutorConfig,
    transcriptTool?: TranscriptSearchTool,
  ) {
    this.searchTool = searchTool;
    this.browseTool = browseTool;
    this.transcriptTool = transcriptTool ?? null;
    this.config = {
      maxIterations: config?.maxIterations ?? 3,
      maxToolCallsPerConversation: config?.maxToolCallsPerConversation ?? 5,
      onToolStart: config?.onToolStart ?? (() => {}),
      onToolComplete: config?.onToolComplete ?? (() => {}),
      logEvent: config?.logEvent ?? (() => {}),
    };
  }

  get toolsAvailable(): { search: boolean; browse: boolean; transcript: boolean } {
    return {
      search: this.searchTool.available,
      browse: this.browseTool.available,
      transcript: this.transcriptTool?.available ?? false,
    };
  }

  getToolSystemPrompt(): string {
    return buildToolSystemPrompt(
      this.searchTool.available,
      this.browseTool.available,
      this.transcriptTool?.available ?? false,
    );
  }

  /**
   * Execute the tool loop: get model response, check for tool tags,
   * execute tools, re-prompt with results, repeat until no tools or max iterations.
   */
  async execute(
    modelCall: ModelCallFn,
    userMessage: string,
    systemPrompt: string,
  ): Promise<ToolExecutionState> {
    const toolsUsed: ToolResult[] = [];
    let iterations = 0;
    let currentPrompt = userMessage;
    let currentSystemPrompt = systemPrompt;

    while (iterations < this.config.maxIterations) {
      if (toolsUsed.length >= this.config.maxToolCallsPerConversation) break;

      const response = await modelCall(currentPrompt, currentSystemPrompt);

      const searchMatch = response.match(SEARCH_TAG);
      const browseMatch = response.match(BROWSE_TAG);
      const transcriptMatch = response.match(TRANSCRIPT_TAG);

      if (!searchMatch && !browseMatch && !transcriptMatch) {
        return { toolsUsed, iterations, finalContent: response };
      }

      // Strip tool tag from the response text to get the model's preamble
      const preamble = response
        .replace(SEARCH_TAG, '')
        .replace(BROWSE_TAG, '')
        .replace(TRANSCRIPT_TAG, '')
        .trim();

      if (searchMatch && this.searchTool.available) {
        const query = searchMatch[1].trim();
        this.config.onToolStart('search', query);

        try {
          const result = await this.searchTool.search(query);
          const formatted = this.searchTool.formatForPrompt(result);
          const toolResult: ToolResult = {
            type: 'search',
            query,
            data: formatted,
            timeTakenMs: result.timeTakenMs,
          };
          toolsUsed.push(toolResult);
          this.config.onToolComplete(toolResult);
          this.config.logEvent(`Tool: search "${query}" (${result.results.length} results)`, {
            tool: 'search', query, resultCount: result.results.length,
          });

          currentPrompt = [
            `[Tool results — the system executed your search request]`,
            '',
            formatted,
            '',
            `Original user message: ${userMessage}`,
            preamble ? `Your previous note: ${preamble}` : '',
            '',
            'Now synthesize these results into a helpful response for the user. Do NOT include another [SEARCH:] or [BROWSE:] tag unless you need additional information.',
          ].filter(Boolean).join('\n');
        } catch (err) {
          const errorResult: ToolResult = {
            type: 'search', query, data: `Search failed: ${err}`, timeTakenMs: 0,
          };
          toolsUsed.push(errorResult);
          currentPrompt = `Search for "${query}" failed: ${err}\n\nOriginal question: ${userMessage}\nPlease respond using your existing knowledge.`;
        }
      } else if (browseMatch && this.browseTool.available) {
        const url = browseMatch[1].trim();
        this.config.onToolStart('browse', url);

        const auth = this.browseTool.isAuthorized(url);
        if (!auth.allowed) {
          const blockedResult: ToolResult = {
            type: 'browse', url, data: `Browse blocked: ${auth.reason}`, timeTakenMs: 0,
          };
          toolsUsed.push(blockedResult);
          currentPrompt = `Cannot browse ${url}: ${auth.reason}\n\nOriginal question: ${userMessage}\nPlease respond noting the domain is not on the whitelist.`;
        } else {
          try {
            const result = await this.browseTool.browse(url, userMessage);
            const formatted = this.browseTool.formatForPrompt(result);
            const toolResult: ToolResult = {
              type: 'browse',
              url,
              data: formatted,
              timeTakenMs: result.timeTakenMs,
            };
            toolsUsed.push(toolResult);
            this.config.onToolComplete(toolResult);
            this.config.logEvent(`Tool: browse ${url} (${result.rawTextLength} chars)`, {
              tool: 'browse', url, authorized: result.authorized, summarizedBy: result.summarizedBy,
            });

            currentPrompt = [
              `[Tool results — the system fetched the web page you requested]`,
              '',
              formatted,
              '',
              `Original user message: ${userMessage}`,
              preamble ? `Your previous note: ${preamble}` : '',
              '',
              'Now synthesize this content into a helpful response for the user. Do NOT include another [SEARCH:] or [BROWSE:] tag unless you need additional information.',
            ].filter(Boolean).join('\n');
          } catch (err) {
            const errorResult: ToolResult = {
              type: 'browse', url, data: `Browse failed: ${err}`, timeTakenMs: 0,
            };
            toolsUsed.push(errorResult);
            currentPrompt = `Browse of ${url} failed: ${err}\n\nOriginal question: ${userMessage}\nPlease respond using your existing knowledge.`;
          }
        }
      } else if (transcriptMatch && this.transcriptTool?.available) {
        const query = transcriptMatch[1].trim();
        this.config.onToolStart('transcript', query);

        try {
          const result = await this.transcriptTool.search(query);
          const formatted = this.transcriptTool.formatForContext(result);
          const toolResult: ToolResult = {
            type: 'transcript',
            query,
            data: formatted,
            timeTakenMs: result.timeTakenMs,
          };
          toolsUsed.push(toolResult);
          this.config.onToolComplete(toolResult);
          this.config.logEvent(`Tool: transcript "${query}" (${result.matches.length} matches)`, {
            tool: 'transcript', query, matchCount: result.matches.length,
          });

          currentPrompt = [
            `[Tool results — the system searched past conversation transcripts]`,
            '',
            formatted,
            '',
            `Original user message: ${userMessage}`,
            preamble ? `Your previous note: ${preamble}` : '',
            '',
            'Now use these past conversation excerpts to inform your response. Reference specific discussions, dates, and decisions when relevant. Do NOT include another tool tag unless you need additional information.',
          ].filter(Boolean).join('\n');
        } catch (err) {
          const errorResult: ToolResult = {
            type: 'transcript', query, data: `Transcript search failed: ${err}`, timeTakenMs: 0,
          };
          toolsUsed.push(errorResult);
          currentPrompt = `Transcript search for "${query}" failed: ${err}\n\nOriginal question: ${userMessage}\nPlease respond using your existing knowledge.`;
        }
      } else {
        // Tool tag present but tool unavailable
        const unavailableMsg = searchMatch
          ? 'Web search is not available (no Brave API key configured).'
          : transcriptMatch
            ? 'Transcript search is not available (no transcripts directory found).'
            : 'Web browsing is not available (no xAI API key configured).';
        currentPrompt = `${unavailableMsg}\n\nOriginal question: ${userMessage}\nPlease respond using your existing knowledge.`;
      }

      iterations++;
    }

    // Max iterations reached — do one final call without tool instructions
    const finalPrompt = [
      toolsUsed.length > 0
        ? `You used ${toolsUsed.length} tool(s). Here are the accumulated results:\n\n${toolsUsed.map(t => t.data).join('\n\n')}`
        : '',
      '',
      `Original user message: ${userMessage}`,
      '',
      'Provide your final response. Do NOT use any tool tags.',
    ].filter(Boolean).join('\n');

    const stripped = systemPrompt.replace(/─── AVAILABLE TOOLS ───[\s\S]*?(?=─── |$)/, '');
    const finalResponse = await modelCall(finalPrompt, stripped);

    return { toolsUsed, iterations, finalContent: finalResponse };
  }
}

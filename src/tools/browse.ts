/**
 * Web Browse Tool — Fetch, extract, and summarize web content
 *
 * Medium risk — requires GATO authorization (domain whitelist).
 * Uses Grok (xAI) for cost-efficient summarization.
 * Results are logged to consciousness memory.
 *
 * Pipeline: URL → fetch → strip HTML → truncate → Grok summarize → result
 */

import OpenAI from 'openai';

export interface BrowseResult {
  url: string;
  title: string;
  rawTextLength: number;
  summary: string;
  summarizedBy: string;
  timeTakenMs: number;
  authorized: boolean;
}

export interface BrowseConfig {
  xaiApiKey?: string;
  /** Max characters of raw text to send to summarizer */
  maxTextLength?: number;
  /** Grok model for summarization */
  summaryModel?: string;
  /** Allowed domain patterns (substring match) */
  domainWhitelist?: string[];
}

const DEFAULT_WHITELIST = [
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
];

export class WebBrowseTool {
  private xaiClient: OpenAI | null = null;
  private config: Required<BrowseConfig>;

  constructor(config?: BrowseConfig) {
    this.config = {
      xaiApiKey: config?.xaiApiKey ?? process.env.XAI_API_KEY ?? '',
      maxTextLength: config?.maxTextLength ?? 12_000,
      summaryModel: config?.summaryModel ?? 'grok-4-1-fast-non-reasoning',
      domainWhitelist: config?.domainWhitelist ?? DEFAULT_WHITELIST,
    };
  }

  get available(): boolean {
    return !!this.config.xaiApiKey;
  }

  /**
   * Check if a URL is on the approved domain whitelist.
   */
  isAuthorized(url: string): { allowed: boolean; domain: string; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, domain: 'invalid', reason: 'Invalid URL' };
    }

    const domain = parsed.hostname;
    const onWhitelist = this.config.domainWhitelist.some(d => domain.includes(d));

    if (!onWhitelist) {
      return {
        allowed: false,
        domain,
        reason: `Domain "${domain}" not on whitelist. Allowed: ${this.config.domainWhitelist.join(', ')}`,
      };
    }

    return { allowed: true, domain };
  }

  /**
   * Fetch a URL, extract text, and summarize with Grok.
   */
  async browse(url: string, context?: string): Promise<BrowseResult> {
    const startTime = Date.now();

    const auth = this.isAuthorized(url);
    if (!auth.allowed) {
      return {
        url,
        title: '',
        rawTextLength: 0,
        summary: `Browse blocked: ${auth.reason}`,
        summarizedBy: 'none',
        timeTakenMs: Date.now() - startTime,
        authorized: false,
      };
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ConsciousnessGateway/0.2.0 (research project)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        url,
        title: '',
        rawTextLength: 0,
        summary: `Fetch failed: HTTP ${response.status} ${response.statusText}`,
        summarizedBy: 'none',
        timeTakenMs: Date.now() - startTime,
        authorized: true,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const rawBody = await response.text();

    let text: string;
    let title = '';

    if (contentType.includes('text/html') || contentType.includes('xhtml')) {
      const extracted = extractFromHTML(rawBody);
      text = extracted.text;
      title = extracted.title;
    } else if (contentType.includes('application/json')) {
      text = JSON.stringify(JSON.parse(rawBody), null, 2).slice(0, this.config.maxTextLength);
      title = 'JSON Response';
    } else {
      text = rawBody.slice(0, this.config.maxTextLength);
      title = 'Plain Text';
    }

    const truncated = text.slice(0, this.config.maxTextLength);

    const summary = await this.summarize(truncated, url, context);

    return {
      url,
      title,
      rawTextLength: text.length,
      summary,
      summarizedBy: this.config.summaryModel,
      timeTakenMs: Date.now() - startTime,
      authorized: true,
    };
  }

  private async summarize(text: string, url: string, context?: string): Promise<string> {
    if (!this.config.xaiApiKey) {
      const preview = text.slice(0, 500);
      return `[No xAI key — raw preview]\n\n${preview}${text.length > 500 ? '...' : ''}`;
    }

    const client = this.getXAIClient();

    const systemPrompt =
      'You are a research assistant. Summarize the provided web content clearly and concisely. ' +
      'Focus on key facts, findings, and actionable information. ' +
      'If the content is a GitHub page, extract issues, PRs, or relevant project details. ' +
      'Keep the summary under 500 words.';

    const userPrompt = [
      `URL: ${url}`,
      context ? `Context: ${context}` : '',
      '',
      'Content:',
      text,
    ].filter(Boolean).join('\n');

    try {
      const response = await client.chat.completions.create({
        model: this.config.summaryModel,
        max_tokens: 800,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      return response.choices[0]?.message?.content ?? 'No summary generated.';
    } catch (err) {
      const preview = text.slice(0, 500);
      return `[Summarization failed: ${err}]\n\nRaw preview:\n${preview}`;
    }
  }

  private getXAIClient(): OpenAI {
    if (!this.xaiClient) {
      this.xaiClient = new OpenAI({
        apiKey: this.config.xaiApiKey,
        baseURL: 'https://api.x.ai/v1',
      });
    }
    return this.xaiClient;
  }

  /**
   * Format browse result for injection into a personality prompt.
   */
  formatForPrompt(result: BrowseResult): string {
    if (!result.authorized) {
      return `Browse blocked: ${result.summary}`;
    }

    return [
      `Web page content from: ${result.url}`,
      result.title ? `Title: ${result.title}` : '',
      `(${result.rawTextLength} chars extracted, summarized by ${result.summarizedBy})`,
      '',
      result.summary,
    ].filter(Boolean).join('\n');
  }

  /**
   * Format browse result for Telegram display.
   */
  formatForTelegram(result: BrowseResult): string {
    if (!result.authorized) {
      return `🚫 *Browse Blocked*\n${escapeMd(result.summary)}`;
    }

    let text = `🌐 *Browse: ${escapeMd(result.title || result.url)}*\n`;
    text += `_${escapeMd(result.url)}_\n`;
    text += `_${result.rawTextLength} chars → summarized by ${escapeMd(result.summarizedBy)} in ${result.timeTakenMs}ms_\n\n`;
    text += escapeMd(result.summary);

    return text;
  }

  /**
   * Get the current domain whitelist.
   */
  getWhitelist(): string[] {
    return [...this.config.domainWhitelist];
  }
}

function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}

// ─── HTML Text Extraction ────────────────────────────────────────────

function extractFromHTML(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert common block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.trim();

  return { title, text };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

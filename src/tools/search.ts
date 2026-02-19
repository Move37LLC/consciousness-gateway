/**
 * Web Search Tool — Brave Search API integration
 *
 * Extends the Gateway's perception space X with web search capability.
 * Low risk — always authorized by GATO.
 * Results are logged to consciousness memory as spatial percepts.
 *
 * API: https://api.search.brave.com/res/v1/web/search
 * Auth: X-Subscription-Token header
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  age?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
  timeTakenMs: number;
}

export class WebSearchTool {
  private apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  }

  get available(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, count: number = 5): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error('BRAVE_SEARCH_API_KEY not configured');
    }

    const startTime = Date.now();

    const params = new URLSearchParams({
      q: query,
      count: String(Math.min(count, 20)),
      extra_snippets: 'true',
    });

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Brave Search API error (${response.status}): ${body}`);
    }

    const data = await response.json() as BraveAPIResponse;

    const results: SearchResult[] = (data.web?.results ?? [])
      .slice(0, count)
      .map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description ?? '',
        age: r.age,
      }));

    return {
      query,
      results,
      totalResults: data.web?.totalEstimatedMatches ?? results.length,
      timeTakenMs: Date.now() - startTime,
    };
  }

  /**
   * Format search results for injection into a personality prompt.
   */
  formatForPrompt(response: SearchResponse): string {
    if (response.results.length === 0) {
      return `Web search for "${response.query}" returned no results.`;
    }

    const lines: string[] = [
      `Web search results for "${response.query}" (${response.results.length} results, ${response.timeTakenMs}ms):`,
      '',
    ];

    for (let i = 0; i < response.results.length; i++) {
      const r = response.results[i];
      lines.push(`[${i + 1}] ${r.title}`);
      lines.push(`    ${r.url}`);
      lines.push(`    ${r.snippet}`);
      if (r.age) lines.push(`    Age: ${r.age}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format search results for Telegram display.
   */
  formatForTelegram(response: SearchResponse): string {
    if (response.results.length === 0) {
      return `🔍 No results for "${response.query}"`;
    }

    let text = `🔍 *Search: "${response.query}"*\n`;
    text += `_${response.results.length} results in ${response.timeTakenMs}ms_\n\n`;

    for (let i = 0; i < response.results.length; i++) {
      const r = response.results[i];
      text += `*${i + 1}. ${escapeMd(r.title)}*\n`;
      text += `${r.url}\n`;
      text += `${escapeMd(r.snippet)}\n`;
      if (r.age) text += `_${r.age}_\n`;
      text += '\n';
    }

    return text;
  }
}

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ─── Brave API Response Types ────────────────────────────────────────

interface BraveAPIResponse {
  web?: {
    results: Array<{
      title: string;
      url: string;
      description?: string;
      age?: string;
      extra_snippets?: string[];
    }>;
    totalEstimatedMatches?: number;
  };
}

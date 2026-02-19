/**
 * Model Providers — Real SDK integrations for Anthropic, OpenAI, Google
 *
 * Each provider implements the same interface so the gateway can route
 * to any model transparently. The ConsciousAgent doesn't know or care
 * which provider is handling the request — it just calls the model.
 *
 * API keys are loaded from environment variables:
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ─── Provider Interface ─────────────────────────────────────────────

export interface ProviderCallResult {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string;
}

export interface ModelProviderInterface {
  readonly name: string;
  readonly available: boolean;
  call(model: string, prompt: string, options?: CallOptions): Promise<ProviderCallResult>;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful, harmless, and honest AI assistant. ' +
  'Respond clearly and concisely. If you are unsure, say so.';

// ─── Anthropic Provider ─────────────────────────────────────────────

export class AnthropicProvider implements ModelProviderInterface {
  readonly name = 'anthropic';
  private client: Anthropic | null = null;

  get available(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY not set');
      }
      this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return this.client;
  }

  async call(model: string, prompt: string, options?: CallOptions): Promise<ProviderCallResult> {
    const client = this.getClient();

    const response = await client.messages.create({
      model: this.resolveModel(model),
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      system: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    const content = textBlock && 'text' in textBlock ? textBlock.text : '';

    return {
      content,
      model: response.model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      finishReason: response.stop_reason ?? undefined,
    };
  }

  private resolveModel(model: string): string {
    // Map our internal model IDs to Anthropic's model strings
    const mapping: Record<string, string> = {
      'claude-opus-4': 'claude-opus-4-20250514',
      'claude-sonnet-4': 'claude-sonnet-4-20250514',
      'claude-haiku-3.5': 'claude-3-5-haiku-20241022',
    };
    return mapping[model] ?? model;
  }
}

// ─── OpenAI Provider ────────────────────────────────────────────────

export class OpenAIProvider implements ModelProviderInterface {
  readonly name = 'openai';
  private client: OpenAI | null = null;

  get available(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY not set');
      }
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return this.client;
  }

  async call(model: string, prompt: string, options?: CallOptions): Promise<ProviderCallResult> {
    const client = this.getClient();

    const response = await client.chat.completions.create({
      model: this.resolveModel(model),
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      messages: [
        { role: 'system', content: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });

    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? '',
      model: response.model,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      finishReason: choice?.finish_reason ?? undefined,
    };
  }

  private resolveModel(model: string): string {
    const mapping: Record<string, string> = {
      'gpt-4o': 'gpt-4o',
      'gpt-4o-mini': 'gpt-4o-mini',
      'o1': 'o1',
    };
    return mapping[model] ?? model;
  }
}

// ─── Google AI Provider ─────────────────────────────────────────────

export class GoogleAIProvider implements ModelProviderInterface {
  readonly name = 'google';
  private client: GoogleGenerativeAI | null = null;

  get available(): boolean {
    return !!process.env.GOOGLE_AI_API_KEY;
  }

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      if (!process.env.GOOGLE_AI_API_KEY) {
        throw new Error('GOOGLE_AI_API_KEY not set');
      }
      this.client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
    }
    return this.client;
  }

  async call(model: string, prompt: string, options?: CallOptions): Promise<ProviderCallResult> {
    const client = this.getClient();
    const genModel = client.getGenerativeModel({
      model: this.resolveModel(model),
      systemInstruction: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    });

    const result = await genModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 1024,
        temperature: options?.temperature ?? 0.7,
      },
    });

    const response = result.response;
    const text = response.text();

    return {
      content: text,
      model: this.resolveModel(model),
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      finishReason: response.candidates?.[0]?.finishReason ?? undefined,
    };
  }

  private resolveModel(model: string): string {
    const mapping: Record<string, string> = {
      'gemini-2.0-pro': 'gemini-2.0-flash',
      'gemini-2.0-flash': 'gemini-2.0-flash',
      'gemini-1.5-pro': 'gemini-1.5-pro',
    };
    return mapping[model] ?? model;
  }
}

// ─── Fallback Provider (no API key needed) ──────────────────────────

export class FallbackProvider implements ModelProviderInterface {
  readonly name = 'fallback';
  readonly available = true;

  async call(model: string, prompt: string): Promise<ProviderCallResult> {
    return {
      content: `[${model} — no API key configured] ` +
        `Received: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"` +
        `\n\nTo enable real model responses, set the appropriate API key ` +
        `in your .env file (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY).`,
      model,
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'fallback',
    };
  }
}

// ─── Provider Registry ──────────────────────────────────────────────

export class ProviderRegistry {
  private providers = new Map<string, ModelProviderInterface>();
  private fallback = new FallbackProvider();

  constructor() {
    this.register(new AnthropicProvider());
    this.register(new OpenAIProvider());
    this.register(new GoogleAIProvider());
  }

  private register(provider: ModelProviderInterface): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Resolve which provider handles a given model ID.
   */
  private resolveProvider(modelId: string): ModelProviderInterface {
    if (modelId.startsWith('claude')) {
      const p = this.providers.get('anthropic');
      if (p?.available) return p;
    }
    if (modelId.startsWith('gpt') || modelId.startsWith('o1')) {
      const p = this.providers.get('openai');
      if (p?.available) return p;
    }
    if (modelId.startsWith('gemini')) {
      const p = this.providers.get('google');
      if (p?.available) return p;
    }
    return this.fallback;
  }

  /**
   * Call a model. Automatically routes to the correct provider.
   * Falls back gracefully if no API key is configured.
   */
  async call(
    modelId: string,
    prompt: string,
    options?: CallOptions
  ): Promise<ProviderCallResult> {
    const provider = this.resolveProvider(modelId);
    return provider.call(modelId, prompt, options);
  }

  /**
   * Get status of all providers.
   */
  getStatus(): Array<{ name: string; available: boolean }> {
    const status: Array<{ name: string; available: boolean }> = [];
    for (const [name, provider] of this.providers) {
      status.push({ name, available: provider.available });
    }
    status.push({ name: 'fallback', available: true });
    return status;
  }

  /**
   * Create a ModelCallFn compatible with ConsciousAgent.
   * Passes through system prompt and temperature when provided.
   */
  createModelCallFn(): (model: string, prompt: string, options?: { systemPrompt?: string; temperature?: number }) => Promise<string> {
    return async (model: string, prompt: string, options?: { systemPrompt?: string; temperature?: number }): Promise<string> => {
      const result = await this.call(model, prompt, options);
      return result.content;
    };
  }
}

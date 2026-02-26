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

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  conversationHistory?: ConversationMessage[];
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

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (options?.conversationHistory?.length) {
      for (const m of options.conversationHistory) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.messages.create({
      model: this.resolveModel(model),
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      system: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      messages,
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

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ];
    if (options?.conversationHistory?.length) {
      for (const m of options.conversationHistory) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: this.resolveModel(model),
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      messages,
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

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (options?.conversationHistory?.length) {
      for (const m of options.conversationHistory) {
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const result = await genModel.generateContent({
      contents,
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

// ─── xAI (Grok) Provider ─────────────────────────────────────────────

export class XAIProvider implements ModelProviderInterface {
  readonly name = 'xai';
  private client: OpenAI | null = null;

  get available(): boolean {
    return !!process.env.XAI_API_KEY;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      if (!process.env.XAI_API_KEY) {
        throw new Error('XAI_API_KEY not set');
      }
      this.client = new OpenAI({
        apiKey: process.env.XAI_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      });
    }
    return this.client;
  }

  async call(model: string, prompt: string, options?: CallOptions): Promise<ProviderCallResult> {
    const client = this.getClient();

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    ];
    if (options?.conversationHistory?.length) {
      for (const m of options.conversationHistory) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model: this.resolveModel(model),
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.7,
      messages,
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
      'grok-4': 'grok-4',
      'grok-4-fast': 'grok-4-1-fast-non-reasoning',
      'grok-3': 'grok-3',
      'grok-3-mini': 'grok-3-mini',
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

// ─── Provider Fallback Chain ────────────────────────────────────────
//
// Priority order: Anthropic → xAI → Google → OpenAI → Fallback
// When the native provider for a model is unavailable, we remap
// the model ID to an equivalent on the next available provider.

const PROVIDER_PRIORITY = ['anthropic', 'xai', 'google', 'openai'] as const;

interface ModelMapping {
  provider: string;
  modelId: string;
}

const MODEL_EQUIVALENTS: Record<string, ModelMapping[]> = {
  'claude-opus-4':   [{ provider: 'anthropic', modelId: 'claude-opus-4' },   { provider: 'xai', modelId: 'grok-4' },      { provider: 'google', modelId: 'gemini-2.0-pro' }, { provider: 'openai', modelId: 'gpt-4o' }],
  'claude-sonnet-4': [{ provider: 'anthropic', modelId: 'claude-sonnet-4' }, { provider: 'xai', modelId: 'grok-3-mini' },  { provider: 'google', modelId: 'gemini-2.0-flash' }, { provider: 'openai', modelId: 'gpt-4o-mini' }],
  'claude-haiku-3.5':[{ provider: 'anthropic', modelId: 'claude-haiku-3.5' },{ provider: 'xai', modelId: 'grok-3-mini' },  { provider: 'google', modelId: 'gemini-2.0-flash' }, { provider: 'openai', modelId: 'gpt-4o-mini' }],
  'grok-4':          [{ provider: 'xai', modelId: 'grok-4' },               { provider: 'anthropic', modelId: 'claude-opus-4' },   { provider: 'google', modelId: 'gemini-2.0-pro' }, { provider: 'openai', modelId: 'gpt-4o' }],
  'grok-3':          [{ provider: 'xai', modelId: 'grok-3' },               { provider: 'anthropic', modelId: 'claude-sonnet-4' }, { provider: 'google', modelId: 'gemini-2.0-pro' }, { provider: 'openai', modelId: 'gpt-4o' }],
  'grok-3-mini':     [{ provider: 'xai', modelId: 'grok-3-mini' },          { provider: 'anthropic', modelId: 'claude-sonnet-4' }, { provider: 'google', modelId: 'gemini-2.0-flash' }, { provider: 'openai', modelId: 'gpt-4o-mini' }],
  'gpt-4o':          [{ provider: 'openai', modelId: 'gpt-4o' },            { provider: 'anthropic', modelId: 'claude-sonnet-4' }, { provider: 'xai', modelId: 'grok-3' },     { provider: 'google', modelId: 'gemini-2.0-pro' }],
  'gpt-4o-mini':     [{ provider: 'openai', modelId: 'gpt-4o-mini' },       { provider: 'xai', modelId: 'grok-3-mini' },  { provider: 'google', modelId: 'gemini-2.0-flash' }, { provider: 'anthropic', modelId: 'claude-haiku-3.5' }],
  'gemini-2.0-pro':  [{ provider: 'google', modelId: 'gemini-2.0-pro' },    { provider: 'anthropic', modelId: 'claude-sonnet-4' }, { provider: 'xai', modelId: 'grok-3' },     { provider: 'openai', modelId: 'gpt-4o' }],
  'gemini-2.0-flash': [{ provider: 'google', modelId: 'gemini-2.0-flash' }, { provider: 'xai', modelId: 'grok-3-mini' },  { provider: 'anthropic', modelId: 'claude-haiku-3.5' }, { provider: 'openai', modelId: 'gpt-4o-mini' }],
};

function getDefaultFallbackChain(modelId: string): ModelMapping[] {
  const nativeProvider = modelId.startsWith('claude') ? 'anthropic'
    : modelId.startsWith('grok') ? 'xai'
    : modelId.startsWith('gemini') ? 'google'
    : modelId.startsWith('gpt') || modelId.startsWith('o1') ? 'openai'
    : null;

  if (!nativeProvider) return [];

  return PROVIDER_PRIORITY
    .filter(p => p !== nativeProvider)
    .map(provider => {
      const fallbackModel = provider === 'anthropic' ? 'claude-sonnet-4'
        : provider === 'xai' ? 'grok-3-mini'
        : provider === 'google' ? 'gemini-2.0-flash'
        : 'gpt-4o';
      return { provider, modelId: fallbackModel };
    });
}

// ─── Provider Registry ──────────────────────────────────────────────

export class ProviderRegistry {
  private providers = new Map<string, ModelProviderInterface>();
  private fallback = new FallbackProvider();

  constructor() {
    this.register(new AnthropicProvider());
    this.register(new OpenAIProvider());
    this.register(new GoogleAIProvider());
    this.register(new XAIProvider());
  }

  private register(provider: ModelProviderInterface): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Resolve which provider and model ID to use, with fallback chain.
   * Returns { provider, modelId } where modelId may be remapped
   * to an equivalent on a different provider.
   */
  private resolveProvider(modelId: string): { provider: ModelProviderInterface; modelId: string } {
    const chain = MODEL_EQUIVALENTS[modelId] ?? [];

    // Try the explicit equivalence chain first
    for (const mapping of chain) {
      const p = this.providers.get(mapping.provider);
      if (p?.available) {
        return { provider: p, modelId: mapping.modelId };
      }
    }

    // Try native provider match (for model IDs not in the equivalents table)
    const nativeProviderName = modelId.startsWith('claude') ? 'anthropic'
      : modelId.startsWith('grok') ? 'xai'
      : modelId.startsWith('gemini') ? 'google'
      : (modelId.startsWith('gpt') || modelId.startsWith('o1')) ? 'openai'
      : null;

    if (nativeProviderName) {
      const p = this.providers.get(nativeProviderName);
      if (p?.available) return { provider: p, modelId };
    }

    // Fall through the default chain for unlisted models
    const defaultChain = getDefaultFallbackChain(modelId);
    for (const mapping of defaultChain) {
      const p = this.providers.get(mapping.provider);
      if (p?.available) {
        console.log(`  [providers] Fallback: ${modelId} → ${mapping.modelId} (${mapping.provider})`);
        return { provider: p, modelId: mapping.modelId };
      }
    }

    // Absolute last resort: try ANY available provider
    for (const providerName of PROVIDER_PRIORITY) {
      const p = this.providers.get(providerName);
      if (p?.available) {
        const fallbackModel = providerName === 'anthropic' ? 'claude-sonnet-4'
          : providerName === 'xai' ? 'grok-3-mini'
          : providerName === 'google' ? 'gemini-2.0-flash'
          : 'gpt-4o';
        console.log(`  [providers] Last-resort fallback: ${modelId} → ${fallbackModel} (${providerName})`);
        return { provider: p, modelId: fallbackModel };
      }
    }

    return { provider: this.fallback, modelId };
  }

  /**
   * Call a model. Automatically routes to the correct provider.
   * Falls back through the provider chain if the primary is unavailable.
   */
  async call(
    modelId: string,
    prompt: string,
    options?: CallOptions
  ): Promise<ProviderCallResult> {
    const resolved = this.resolveProvider(modelId);
    return resolved.provider.call(resolved.modelId, prompt, options);
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
  createModelCallFn(): (model: string, prompt: string, options?: { systemPrompt?: string; temperature?: number; conversationHistory?: ConversationMessage[] }) => Promise<string> {
    return async (model: string, prompt: string, options?: { systemPrompt?: string; temperature?: number; conversationHistory?: ConversationMessage[] }): Promise<string> => {
      const result = await this.call(model, prompt, options);
      return result.content;
    };
  }
}

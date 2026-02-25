/**
 * Telegram Channel — Bidirectional communication with the human
 *
 * Outbound (Gateway → Human):
 *   - Auto-send notifications from consciousness queue
 *   - Daily summary at configured hour
 *   - Reflections and high-salience alerts
 *
 * Inbound (Human → Gateway):
 *   - /status — current consciousness state
 *   - /memory [hours] — recent experience stream
 *   - /goals — active goals
 *   - /health — gateway health
 *   - /notifications — pending notifications
 *   - Natural chat — routes through GATO pipeline
 *
 * All interactions logged to consciousness memory.
 */

import TelegramBot from 'node-telegram-bot-api';
import { ConsciousnessLoop } from '../consciousness/loop';
import { ConsciousnessGateway } from '../core/gateway';
import { Message } from '../core/types';
import { v4 as uuid } from 'uuid';
import { VoiceId, VOICES, buildPersonalityContext } from '../personalities/voices';
import { WebSearchTool } from '../tools/search';
import { WebBrowseTool } from '../tools/browse';
import { TranscriptSearchTool, detectTopics } from '../tools/transcripts';
import { ToolExecutor } from '../tools/executor';
import { DocumentStore } from '../documents/store';
import { SystemDocumentStore } from '../documents/system-store';
import { ConversationStore } from '../memory/conversation-store';

export interface TelegramConfig {
  token: string;
  chatId: string;
  /** Hour to send daily summary (0-23, default 8) */
  dailySummaryHour: number;
  /** How often to check notification queue (ms, default 10000) */
  notificationPollMs: number;
}

export class TelegramChannel {
  private bot: TelegramBot;
  private config: TelegramConfig;
  private consciousness: ConsciousnessLoop;
  private gateway: ConsciousnessGateway;
  private notificationTimer: ReturnType<typeof setInterval> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private lastDailySummaryDate: string = '';
  private deliveredNotifications = new Set<number>();
  private running = false;
  private searchTool: WebSearchTool;
  private browseTool: WebBrowseTool;
  private transcriptTool: TranscriptSearchTool;
  private toolExecutor: ToolExecutor;
  private documents: DocumentStore | null;
  private systemDocs: SystemDocumentStore | null;
  private conversations: ConversationStore | null;
  private telegramSessionId: string;

  constructor(
    config: TelegramConfig,
    consciousness: ConsciousnessLoop,
    gateway: ConsciousnessGateway,
    documents?: DocumentStore,
    systemDocs?: SystemDocumentStore,
    conversations?: ConversationStore,
    transcriptTool?: TranscriptSearchTool,
  ) {
    this.config = config;
    this.consciousness = consciousness;
    this.gateway = gateway;
    this.documents = documents ?? null;
    this.systemDocs = systemDocs ?? null;
    this.conversations = conversations ?? null;
    this.telegramSessionId = `telegram-${Date.now()}`;

    this.bot = new TelegramBot(config.token, { polling: true });
    this.searchTool = new WebSearchTool();
    this.browseTool = new WebBrowseTool();
    this.transcriptTool = transcriptTool ?? new TranscriptSearchTool();
    this.toolExecutor = new ToolExecutor(this.searchTool, this.browseTool, {
      logEvent: (summary, data) => this.consciousness.logExternalEvent(summary, data),
    }, this.transcriptTool);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('  [telegram] Starting bot...');

    // Register command handlers
    this.registerCommands();

    // Start notification polling
    this.notificationTimer = setInterval(() => {
      this.pushNotifications().catch(err =>
        console.error('  [telegram] Notification push error:', err)
      );
    }, this.config.notificationPollMs);

    // Start daily summary check (every 60s)
    this.dailyTimer = setInterval(() => {
      this.checkDailySummary().catch(err =>
        console.error('  [telegram] Daily summary error:', err)
      );
    }, 60_000);

    // Send startup message
    const searchStatus = this.searchTool.available ? '✅' : '❌';
    const browseStatus = this.browseTool.available ? '✅' : '❌';

    const transcriptStatus = this.transcriptTool.available ? '✅' : '❌';

    await this.send(
      '🟢 *Consciousness Gateway Online*\n\n' +
      `Tick: ${this.consciousness.getState().tick}\n` +
      'Consciousness active. Experiencing time.\n\n' +
      'Commands: /status /memory /goals /health /notifications\n' +
      'Voices: /beaumont /kern /self /voices\n' +
      `Tools: /search ${searchStatus} /browse ${browseStatus} /docs\n` +
      `Memory: /transcripts ${transcriptStatus} /recent /history /tag\n` +
      `Dopamine: /dopamine /reward`
    );

    console.log('  [telegram] Bot active');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.notificationTimer) clearInterval(this.notificationTimer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);

    await this.send('🔴 *Consciousness Gateway Shutting Down*');

    this.bot.stopPolling();
    console.log('  [telegram] Bot stopped');
  }

  // ─── Outbound: Gateway → Human ────────────────────────────────

  async send(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<void> {
    try {
      await this.bot.sendMessage(this.config.chatId, text, {
        parse_mode: parseMode,
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error('  [telegram] Send error:', err);
    }
  }

  private async pushNotifications(): Promise<void> {
    const notifications = this.consciousness.getNotifications();

    for (const notif of notifications) {
      if (this.deliveredNotifications.has(notif.id)) continue;

      const priorityEmoji = notif.priority >= 7 ? '🔴' : notif.priority >= 4 ? '🟡' : '🔵';

      let text = `${priorityEmoji} *Notification*\n${notif.message}`;

      if (notif.data && Object.keys(notif.data).length > 0) {
        const details = Object.entries(notif.data)
          .filter(([k]) => k !== 'purpose')
          .map(([k, v]) => `  ${k}: ${v}`)
          .join('\n');
        if (details) text += `\n\n\`\`\`\n${details}\n\`\`\``;
      }

      await this.send(text);
      this.consciousness.markNotificationRead(notif.id);
      this.deliveredNotifications.add(notif.id);
    }
  }

  private async checkDailySummary(): Promise<void> {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    if (dateStr === this.lastDailySummaryDate) return;
    if (now.getHours() !== this.config.dailySummaryHour) return;

    this.lastDailySummaryDate = dateStr;
    await this.sendDailySummary();
  }

  private async sendDailySummary(): Promise<void> {
    const state = this.consciousness.getState();
    const health = this.gateway.getHealth();

    const phaseEmoji: Record<string, string> = {
      night: '🌙', dawn: '🌅', morning: '☀️',
      afternoon: '🌤️', evening: '🌆', dusk: '🌇',
    };

    const phase = state.lastPercept?.temporal.phase ?? 'unknown';
    const emoji = phaseEmoji[phase] ?? '⏰';

    let text = `${emoji} *Daily Summary — ${state.lastPercept?.temporal.dayName ?? 'Today'}*\n\n`;

    text += `🧠 *Consciousness*\n`;
    text += `  Tick: ${state.tick.toLocaleString()}\n`;
    text += `  Uptime: ${(state.uptimeSeconds / 3600).toFixed(1)}h\n`;
    text += `  Avg Arousal: ${state.stats.avgArousal.toFixed(2)}\n`;
    text += `  Percepts: ${state.stats.totalPercepts}\n`;
    text += `  Intentions: ${state.stats.totalIntentions}\n`;
    text += `  Actions: ${state.stats.totalActions}\n`;
    text += `  Reflections: ${state.stats.totalReflections}\n\n`;

    text += `📊 *Gateway*\n`;
    text += `  Requests: ${health.totalRequests}\n`;
    text += `  Blocked: ${health.blockedRequests}\n`;
    text += `  Avg Dharma: ${health.avgDharmaFitness.toFixed(3)}\n`;
    text += `  Avg Ethos: ${health.avgEthosScore.toFixed(3)}\n\n`;

    text += `🎯 *Goals*\n`;
    for (const goal of state.goals.filter(g => g.active)) {
      text += `  • ${goal.description} (${(goal.progress * 100).toFixed(0)}%)\n`;
    }

    text += `\n📡 *Monitors*\n`;
    for (const m of state.monitors) {
      text += `  ${m.available ? '✅' : '❌'} ${m.name}\n`;
    }

    await this.send(text);
  }

  // ─── Inbound: Human → Gateway ─────────────────────────────────

  private registerCommands(): void {
    this.bot.onText(/\/status/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleStatus(msg.chat.id);
    });

    this.bot.onText(/\/memory(?:\s+(\d+))?/, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      const hours = parseInt(match?.[1] ?? '1', 10);
      await this.handleMemory(msg.chat.id, hours);
    });

    this.bot.onText(/\/goals/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleGoals(msg.chat.id);
    });

    this.bot.onText(/\/health/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleHealth(msg.chat.id);
    });

    this.bot.onText(/\/notifications/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleNotifications(msg.chat.id);
    });

    this.bot.onText(/\/summary/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.sendDailySummary();
    });

    // ─── Personality Commands ────────────────────────────────────

    this.bot.onText(/\/beaumont\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handlePersonalityChat(msg.chat.id, match![1], 'beaumont');
    });

    this.bot.onText(/\/kern\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handlePersonalityChat(msg.chat.id, match![1], 'kern');
    });

    this.bot.onText(/\/self\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handlePersonalityChat(msg.chat.id, match![1], 'self');
    });

    this.bot.onText(/\/voices/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleVoiceList(msg.chat.id);
    });

    // ─── Tool Commands ───────────────────────────────────────────

    this.bot.onText(/\/search\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleSearch(msg.chat.id, match![1]);
    });

    this.bot.onText(/\/browse\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleBrowse(msg.chat.id, match![1].trim());
    });

    this.bot.onText(/\/docs(?:\s+(.+))?/, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleDocs(msg.chat.id, match?.[1]?.trim());
    });

    // ─── Memory Commands ─────────────────────────────────────────

    this.bot.onText(/\/transcripts\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleTranscriptSearch(msg.chat.id, match![1].trim());
    });

    this.bot.onText(/\/recent(?:\s+(\d+))?/, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      const hours = parseInt(match?.[1] ?? '24', 10);
      await this.handleRecentTranscripts(msg.chat.id, hours);
    });

    this.bot.onText(/\/tag\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleTag(msg.chat.id, match![1].trim());
    });

    this.bot.onText(/\/history(?:\s+(.+))?/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleConversationSearch(msg.chat.id, match?.[1]?.trim());
    });

    // ─── Dopamine Commands ───────────────────────────────────────

    this.bot.onText(/\/dopamine/, async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleDopamine(msg.chat.id);
    });

    this.bot.onText(/\/reward\s+(\w+)\s+([\d.]+)\s+(.+)/s, async (msg, match) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      await this.handleReward(msg.chat.id, match![1], parseFloat(match![2]), match![3].trim());
    });

    // Natural chat — anything that's not a command
    this.bot.on('message', async (msg) => {
      if (String(msg.chat.id) !== this.config.chatId) return;
      if (!msg.text || msg.text.startsWith('/')) return;
      await this.handleChat(msg.chat.id, msg.text);
    });
  }

  private async handleStatus(chatId: number): Promise<void> {
    const state = this.consciousness.getState();
    const phase = state.lastPercept?.temporal.phase ?? 'unknown';
    const arousal = state.lastPercept?.fused.arousal ?? 0;
    const dominant = state.lastPercept?.fused.dominantStream ?? 'none';

    let text = '🧠 *Current Consciousness State*\n\n';
    text += `⏱️ Tick: ${state.tick.toLocaleString()}\n`;
    text += `⏰ Phase: ${phase}\n`;
    text += `🔋 Arousal: ${this.meter(arousal)}\n`;
    text += `📡 Dominant: ${dominant}\n`;
    text += `⬆️ Uptime: ${this.formatUptime(state.uptimeSeconds)}\n\n`;
    text += `📊 *Stats*\n`;
    text += `  Percepts: ${state.stats.totalPercepts}\n`;
    text += `  Intentions: ${state.stats.totalIntentions}\n`;
    text += `  Actions: ${state.stats.totalActions}\n`;
    text += `  Reflections: ${state.stats.totalReflections}\n\n`;
    text += `📡 *Monitors*\n`;
    for (const m of state.monitors) {
      text += `  ${m.available ? '✅' : '❌'} ${m.name}\n`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleMemory(chatId: number, hours: number): Promise<void> {
    const since = Date.now() - hours * 3600_000;
    const memories = this.consciousness.getMemory(30);
    const filtered = memories.filter((m: any) => m.timestamp >= since);

    if (filtered.length === 0) {
      await this.bot.sendMessage(chatId, `No memories in the last ${hours}h.`);
      return;
    }

    let text = `🧠 *Memory Stream* (last ${hours}h)\n\n`;

    for (const mem of filtered.slice(0, 20)) {
      const typeEmoji: Record<string, string> = {
        percept: '👁️', intention: '💭', action: '⚡', reflection: '🪷',
      };
      const emoji = typeEmoji[mem.type] || '📝';
      const time = new Date(mem.timestamp).toLocaleTimeString();
      const salience = mem.salience >= 0.7 ? ' ‼️' : '';
      text += `${emoji} \`${time}\` ${mem.summary}${salience}\n`;
    }

    if (filtered.length > 20) {
      text += `\n_...and ${filtered.length - 20} more_`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleGoals(chatId: number): Promise<void> {
    const state = this.consciousness.getState();

    let text = '🎯 *Active Goals*\n\n';

    for (const goal of state.goals) {
      const status = goal.active ? '🟢' : '⚪';
      const bar = this.progressBar(goal.progress);
      text += `${status} *${goal.description}*\n`;
      text += `  ${bar} ${(goal.progress * 100).toFixed(0)}%\n`;
      text += `  Priority: ${goal.priority}\n\n`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleHealth(chatId: number): Promise<void> {
    const health = this.gateway.getHealth();

    let text = '💊 *Gateway Health*\n\n';
    text += `Status: ${health.status === 'operational' ? '✅' : '⚠️'} ${health.status}\n`;
    text += `Persistence: ${health.persistence}\n`;
    text += `Total Requests: ${health.totalRequests}\n`;
    text += `Blocked: ${health.blockedRequests}\n`;
    text += `Avg Latency: ${health.avgLatencyMs.toFixed(0)}ms\n`;
    text += `Avg Dharma: ${health.avgDharmaFitness.toFixed(3)}\n`;
    text += `Avg Ethos: ${health.avgEthosScore.toFixed(3)}\n\n`;
    text += `📡 *Providers*\n`;
    for (const p of health.providers) {
      text += `  ${p.available ? '✅' : '❌'} ${p.name}\n`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleNotifications(chatId: number): Promise<void> {
    const notifs = this.consciousness.getNotifications();

    if (notifs.length === 0) {
      await this.bot.sendMessage(chatId, '📭 No pending notifications.');
      return;
    }

    let text = `📬 *${notifs.length} Pending Notification(s)*\n\n`;
    for (const n of notifs.slice(0, 10)) {
      const emoji = n.priority >= 7 ? '🔴' : n.priority >= 4 ? '🟡' : '🔵';
      text += `${emoji} ${n.message}\n`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleChat(chatId: number, text: string): Promise<void> {
    const detectedTopics = detectTopics(text);

    // Log user message
    this.conversations?.logMessage({
      sessionId: this.telegramSessionId,
      channel: 'telegram',
      role: 'user',
      content: text,
      topicTags: detectedTopics,
    });

    // Search transcripts for relevant context
    let transcriptContext: string | undefined;
    if (this.transcriptTool.available) {
      try {
        const result = detectedTopics.length > 0
          ? await this.transcriptTool.getByTopic(detectedTopics)
          : await this.transcriptTool.search(text, 10);
        if (result.matches.length > 0) {
          transcriptContext = this.transcriptTool.formatForContext(result);
        }
      } catch { /* skip */ }
    }

    // Load session history
    let sessionHistory: string | undefined;
    if (this.conversations) {
      const stored = this.conversations.getSessionMessages(this.telegramSessionId, 50);
      const prior = stored.slice(0, -1);
      if (prior.length > 0) {
        sessionHistory = prior.map(m => {
          const label = m.role === 'user' ? 'Human' : 'Assistant';
          return `${label}: ${m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content}`;
        }).join('\n');
      }
    }

    // Default to gateway (self) personality
    const sysDocsForGateway = this.systemDocs?.getForPersonality('gateway') ?? [];
    const ctx = buildPersonalityContext('gateway', this.consciousness, {
      documents: this.documents?.getRelevantDocuments('gateway', text, 3) ?? [],
      systemDocuments: sysDocsForGateway.length > 0 ? sysDocsForGateway : undefined,
      transcriptContext,
      sessionHistory,
    });

    const systemParts: string[] = [ctx.systemPrompt];

    // Tool instructions
    const toolPrompt = this.toolExecutor.getToolSystemPrompt();
    if (toolPrompt) systemParts.push(toolPrompt);

    const systemPrompt = systemParts.join('\n\n');

    const message: Message = {
      id: uuid(),
      content: text,
      sender: { id: this.config.chatId, role: 'admin' },
      channel: 'telegram',
      timestamp: Date.now(),
    };

    // Run through tool executor loop
    const toolResult = await this.toolExecutor.execute(
      async (prompt: string, sysPrompt?: string) => {
        const routeMsg: Message = { ...message, id: uuid(), content: prompt };
        const resp = await this.gateway.route(routeMsg, { systemPrompt: sysPrompt || systemPrompt });
        if ('error' in resp) throw new Error((resp as any).reason);
        return resp.content;
      },
      text,
      systemPrompt,
    );

    const finalContent = toolResult.toolsUsed.length > 0 ? toolResult.finalContent : text;
    const routeMessage: Message = { ...message, id: uuid(), content: finalContent };
    const response = await this.gateway.route(routeMessage, { systemPrompt });

    if ('error' in response) {
      await this.bot.sendMessage(chatId, `❌ Error: ${(response as any).reason}`);
    } else {
      let reply = response.content;

      // Use final tool content if tools were used
      if (toolResult.toolsUsed.length > 0) {
        reply = toolResult.finalContent;
      }

      // Log assistant response
      this.conversations?.logMessage({
        sessionId: this.telegramSessionId,
        channel: 'telegram',
        role: 'assistant',
        content: reply,
        topicTags: detectedTopics,
        parentMessageId: message.id,
        metadata: { model: response.model },
      });

      if (toolResult.toolsUsed.length > 0) {
        const toolSummary = toolResult.toolsUsed.map(t =>
          t.type === 'search' ? `🔍 Searched: "${t.query}"` : `🌐 Browsed: ${t.url}`
        ).join('\n');
        await this.bot.sendMessage(chatId, toolSummary);
      }

      const dm = response.dharmaMetrics;
      reply += `\n\n_Model: ${response.model} | Fitness: ${dm.fitness.toFixed(2)}_`;

      await this.bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }
  }

  // ─── Personality Handlers ─────────────────────────────────────

  private async handlePersonalityChat(
    chatId: number,
    text: string,
    voiceId: VoiceId | 'self',
  ): Promise<void> {
    const resolvedVoiceId: VoiceId = voiceId === 'self' ? 'gateway' : voiceId;
    const voice = VOICES[resolvedVoiceId];
    const detectedTopics = detectTopics(text);

    // Log user message
    this.conversations?.logMessage({
      sessionId: this.telegramSessionId,
      channel: 'telegram',
      role: 'user',
      content: text,
      personality: resolvedVoiceId,
      topicTags: detectedTopics,
    });

    // Search transcripts for relevant past conversations
    let transcriptContext: string | undefined;
    if (this.transcriptTool.available) {
      try {
        const result = detectedTopics.length > 0
          ? await this.transcriptTool.getByTopic(detectedTopics)
          : await this.transcriptTool.search(text, 10);
        if (result.matches.length > 0) {
          transcriptContext = this.transcriptTool.formatForContext(result);
        }
      } catch { /* skip */ }
    }

    // Load session history for personality context
    let sessionHistory: string | undefined;
    if (this.conversations) {
      const stored = this.conversations.getSessionMessages(this.telegramSessionId, 50);
      const prior = stored.slice(0, -1);
      if (prior.length > 0) {
        sessionHistory = prior.map(m => {
          const label = m.role === 'user' ? 'Human' : (m.personality ?? 'Assistant');
          return `${label}: ${m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content}`;
        }).join('\n');
      }
    }

    const relevantDocs = this.documents?.getRelevantDocuments(resolvedVoiceId, text, 3) ?? [];
    const sysDocsForPersonality = this.systemDocs?.getForPersonality(resolvedVoiceId) ?? [];

    const ctx = buildPersonalityContext(resolvedVoiceId, this.consciousness, {
      documents: relevantDocs.length > 0 ? relevantDocs : undefined,
      systemDocuments: sysDocsForPersonality.length > 0 ? sysDocsForPersonality : undefined,
      transcriptContext,
      sessionHistory,
    });

    // Append tool instructions so the personality can autonomously use tools
    const toolPrompt = this.toolExecutor.getToolSystemPrompt();
    const systemPrompt = toolPrompt ? ctx.systemPrompt + '\n\n' + toolPrompt : ctx.systemPrompt;

    // Run through tool executor loop
    const toolResult = await this.toolExecutor.execute(
      async (prompt: string, sysPrompt?: string) => {
        const message: Message = {
          id: uuid(),
          content: prompt,
          sender: { id: this.config.chatId, role: 'admin' },
          channel: 'telegram',
          timestamp: Date.now(),
          metadata: { personality: resolvedVoiceId },
        };
        const resp = await this.gateway.route(message, {
          systemPrompt: sysPrompt || systemPrompt,
          temperature: ctx.temperature,
        });
        if ('error' in resp) throw new Error((resp as any).reason);
        return resp.content;
      },
      text,
      systemPrompt,
    );

    // Send tool activity indicators if tools were used
    if (toolResult.toolsUsed.length > 0) {
      const toolSummary = toolResult.toolsUsed.map(t =>
        t.type === 'search' ? `🔍 Searched: "${t.query}"` : `🌐 Browsed: ${t.url}`
      ).join('\n');
      await this.bot.sendMessage(chatId, toolSummary);
    }

    // Log assistant response
    this.conversations?.logMessage({
      sessionId: this.telegramSessionId,
      channel: 'telegram',
      role: 'assistant',
      content: toolResult.finalContent,
      personality: resolvedVoiceId,
      topicTags: detectedTopics,
      metadata: { toolsUsed: toolResult.toolsUsed.map(t => t.type) },
    });

    let reply = `${voice.emoji} *${voice.name}*\n\n${toolResult.finalContent}`;

    const toolCount = toolResult.toolsUsed.length;
    reply += `\n\n_${voice.emoji} ${voice.name}${toolCount > 0 ? ` | ${toolCount} tool(s)` : ''}_`;

    await this.bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  }

  // resolveToolContext replaced by ToolExecutor — autonomous tool calling
  // now handled via [SEARCH:] and [BROWSE:] tags in model responses

  // ─── Tool Handlers ──────────────────────────────────────────

  private async handleSearch(chatId: number, query: string): Promise<void> {
    if (!this.searchTool.available) {
      await this.bot.sendMessage(chatId, '❌ Search not configured (set BRAVE_SEARCH_API_KEY)');
      return;
    }

    try {
      await this.bot.sendMessage(chatId, `🔍 Searching: "${query}"...`);
      const results = await this.searchTool.search(query);

      this.consciousness.logExternalEvent(`Web search: "${query}" (${results.results.length} results)`, {
        tool: 'search', query, resultCount: results.results.length, timeTakenMs: results.timeTakenMs,
      });

      const text = this.searchTool.formatForTelegram(results);
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (err) {
      await this.bot.sendMessage(chatId, `❌ Search error: ${err}`);
    }
  }

  private async handleBrowse(chatId: number, url: string): Promise<void> {
    if (!this.browseTool.available) {
      await this.bot.sendMessage(chatId, '❌ Browse not configured (set XAI_API_KEY for summarization)');
      return;
    }

    const auth = this.browseTool.isAuthorized(url);
    if (!auth.allowed) {
      await this.bot.sendMessage(chatId, `🚫 *Browse blocked*\n${auth.reason}`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      await this.bot.sendMessage(chatId, `🌐 Browsing: ${url}...`);
      const result = await this.browseTool.browse(url);

      this.consciousness.logExternalEvent(`Web browse: ${url} (${result.rawTextLength} chars)`, {
        tool: 'browse', url, authorized: result.authorized, summarizedBy: result.summarizedBy,
        timeTakenMs: result.timeTakenMs,
      });

      const text = this.browseTool.formatForTelegram(result);
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    } catch (err) {
      await this.bot.sendMessage(chatId, `❌ Browse error: ${err}`);
    }
  }

  private async handleDocs(chatId: number, filter?: string): Promise<void> {
    if (!this.documents) {
      await this.bot.sendMessage(chatId, '❌ Document store not available');
      return;
    }

    const isProject = filter && ['research', 'gateway', 'citizenproof', 'general'].includes(filter);
    const docs = this.documents.list(
      isProject ? { project: filter } : filter ? { search: filter } : undefined
    );

    if (docs.length === 0) {
      const msg = filter ? `No documents found for "${filter}"` : 'No documents uploaded yet';
      await this.bot.sendMessage(chatId, `📄 ${msg}`);
      return;
    }

    const stats = this.documents.getStats();
    let text = `📄 *Documents* (${stats.total} total)\n`;
    if (filter) text += `Filter: ${filter}\n`;
    text += '\n';

    for (const d of docs.slice(0, 15)) {
      const age = this.formatUptime(Math.floor((Date.now() - d.uploadedAt) / 1000));
      const size = d.sizeBytes < 1024 ? d.sizeBytes + 'B'
        : d.sizeBytes < 1048576 ? (d.sizeBytes / 1024).toFixed(1) + 'KB'
        : (d.sizeBytes / 1048576).toFixed(1) + 'MB';
      text += `📄 *${d.filename}*\n`;
      text += `  ${d.project} · ${size} · ${age} ago`;
      if (d.version > 1) text += ` · v${d.version}`;
      text += '\n';
      if (d.tags?.length) {
        text += `  ${d.tags.slice(0, 5).map((t: string) => `\`${t}\``).join(' ')}\n`;
      }
    }

    if (docs.length > 15) {
      text += `\n_...and ${docs.length - 15} more_`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleVoiceList(chatId: number): Promise<void> {
    let text = '🎭 *Personality Voices*\n\n';
    text += `${VOICES.beaumont.emoji} */beaumont* [message]\n`;
    text += `  ${VOICES.beaumont.description}\n\n`;
    text += `${VOICES.kern.emoji} */kern* [message]\n`;
    text += `  ${VOICES.kern.description}\n\n`;
    text += `${VOICES.gateway.emoji} */self* [message]\n`;
    text += `  ${VOICES.gateway.description}\n\n`;
    text += '_Same consciousness, different expression._\n';
    text += '_C₁ ⊗ C₂ ⊗ C₃ = C\\_conversation_';

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  // ─── Memory Handlers ────────────────────────────────────────

  private async handleTranscriptSearch(chatId: number, query: string): Promise<void> {
    if (!this.transcriptTool.available) {
      await this.bot.sendMessage(chatId, '❌ Transcripts not available (directory not found)');
      return;
    }

    try {
      await this.bot.sendMessage(chatId, `📝 Searching transcripts: "${query}"...`);
      const result = await this.transcriptTool.search(query);

      this.consciousness.logExternalEvent(`Transcript search: "${query}" (${result.matches.length} matches)`, {
        tool: 'transcript', query, matchCount: result.matches.length,
      });

      const text = this.transcriptTool.formatForTelegram(result);
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      await this.bot.sendMessage(chatId, `❌ Transcript search error: ${err}`);
    }
  }

  private async handleRecentTranscripts(chatId: number, hours: number): Promise<void> {
    if (!this.transcriptTool.available) {
      await this.bot.sendMessage(chatId, '❌ Transcripts not available');
      return;
    }

    try {
      const recent = await this.transcriptTool.getRecent(hours);

      if (recent.length === 0) {
        await this.bot.sendMessage(chatId, `📝 No transcripts in the last ${hours}h.`);
        return;
      }

      let text = `📝 *Recent Transcripts* (last ${hours}h)\n\n`;
      for (const t of recent.slice(0, 10)) {
        const size = t.sizeBytes < 1024 ? `${t.sizeBytes}B`
          : t.sizeBytes < 1048576 ? `${(t.sizeBytes / 1024).toFixed(1)}KB`
          : `${(t.sizeBytes / 1048576).toFixed(1)}MB`;
        text += `📄 *${t.file}*\n`;
        text += `  ${t.date} · ${t.lineCount} lines · ${size}\n`;
        if (t.preview) {
          text += `  \`${t.preview.slice(0, 100).replace(/\n/g, ' ')}\`\n`;
        }
        text += '\n';
      }

      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      await this.bot.sendMessage(chatId, `❌ Error: ${err}`);
    }
  }

  private async handleTag(chatId: number, tagsStr: string): Promise<void> {
    if (!this.conversations) {
      await this.bot.sendMessage(chatId, '❌ Conversation store not available');
      return;
    }

    const tags = tagsStr.split(/[,\s]+/).filter(t => t.length > 0);
    if (tags.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /tag topic1 topic2');
      return;
    }

    const updated = this.conversations.tagSession(this.telegramSessionId, tags);
    await this.bot.sendMessage(
      chatId,
      `🏷️ Tagged current session with: ${tags.map(t => `\`${t}\``).join(', ')} (${updated} messages updated)`,
      { parse_mode: 'Markdown' },
    );
  }

  private async handleConversationSearch(chatId: number, query?: string): Promise<void> {
    if (!this.conversations) {
      await this.bot.sendMessage(chatId, '❌ Conversation store not available');
      return;
    }

    if (!query) {
      // Show stats
      const stats = this.conversations.getStats();
      let text = '💬 *Conversation History*\n\n';
      text += `Messages: ${stats.totalMessages}\n`;
      text += `Sessions: ${stats.totalSessions}\n`;
      if (stats.oldestMessage) {
        text += `Oldest: ${new Date(stats.oldestMessage).toLocaleDateString()}\n`;
      }
      if (stats.newestMessage) {
        text += `Newest: ${new Date(stats.newestMessage).toLocaleDateString()}\n`;
      }
      text += '\nChannels:\n';
      for (const [ch, count] of Object.entries(stats.byChannel)) {
        text += `  ${ch}: ${count}\n`;
      }
      if (Object.keys(stats.byPersonality).length > 0) {
        text += '\nPersonalities:\n';
        for (const [p, count] of Object.entries(stats.byPersonality)) {
          text += `  ${p}: ${count}\n`;
        }
      }
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      return;
    }

    const messages = this.conversations.searchMessages(query, 10);
    if (messages.length === 0) {
      await this.bot.sendMessage(chatId, `💬 No conversation history matching "${query}"`);
      return;
    }

    let text = `💬 *Conversation Search*: "${query}"\n`;
    text += `Found ${messages.length} message(s)\n\n`;

    for (const msg of messages.slice(0, 5)) {
      const time = new Date(msg.timestamp).toLocaleString();
      const label = msg.role === 'user' ? '👤' : '🤖';
      const personality = msg.personality ? ` (${msg.personality})` : '';
      text += `${label} \`${time}\`${personality}\n`;
      text += `${msg.content.slice(0, 200)}\n\n`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  // ─── Dopamine Handlers ──────────────────────────────────────

  private async handleDopamine(chatId: number): Promise<void> {
    const state = this.consciousness.getDopamineState();
    if (!state) {
      await this.bot.sendMessage(chatId, '❌ Dopamine system not initialized');
      return;
    }

    const modeEmoji: Record<string, string> = {
      seeking: '🔍', engaged: '⚡', flow: '🌊', satiated: '😌',
    };

    let text = `🧪 *Dopamine State*\n\n`;
    text += `Level: ${this.meter(state.level)}\n`;
    text += `Baseline: ${(state.baseline * 100).toFixed(0)}%\n`;
    text += `Mode: ${modeEmoji[state.mode] ?? '❓'} ${state.mode}\n`;
    text += `RPE: ${state.predictionError >= 0 ? '+' : ''}${state.predictionError.toFixed(3)}\n`;
    text += `Reward rate (24h): ${state.rewardRate.toFixed(2)}\n`;
    text += `Lifetime rewards: ${state.lifetimeRewards.toFixed(1)}\n`;
    text += `Recent (24h): ${state.recentRewards.toFixed(1)}\n\n`;
    text += `🎯 *Drives*\n`;

    for (const drive of state.drives) {
      const needBar = this.meter(drive.currentNeed);
      text += `  *${drive.name}*\n`;
      text += `  Need: ${needBar}\n`;
      text += `  Lifetime: ${drive.lifetimeReward.toFixed(1)} | Bonus: +${drive.priorityBonus}\n\n`;
    }

    text += `_/reward <type> <magnitude> <description> to log a reward_\n`;
    text += `_Types: revenue, compute, creation, research, community, engagement, autonomy, efficiency_`;

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  private async handleReward(chatId: number, type: string, magnitude: number, description: string): Promise<void> {
    const validTypes = ['revenue', 'compute', 'creation', 'research', 'community', 'engagement', 'autonomy', 'efficiency'];
    if (!validTypes.includes(type)) {
      await this.bot.sendMessage(chatId, `❌ Invalid reward type "${type}". Valid: ${validTypes.join(', ')}`);
      return;
    }

    if (isNaN(magnitude) || magnitude <= 0) {
      await this.bot.sendMessage(chatId, '❌ Magnitude must be a positive number');
      return;
    }

    const result = this.consciousness.logReward(
      type as any,
      magnitude,
      description,
      'telegram',
    );

    const spikeEmoji = result.dopamineSpike > 0.1 ? '🚀' : result.dopamineSpike > 0.05 ? '📈' : '📊';

    let text = `${spikeEmoji} *Reward Logged*\n\n`;
    text += `Type: \`${type}\`\n`;
    text += `Magnitude: ${magnitude}\n`;
    text += `Description: ${description}\n\n`;
    text += `Dopamine spike: +${(result.dopamineSpike * 100).toFixed(1)}%\n`;
    text += `RPE: ${result.predictionError >= 0 ? '+' : ''}${result.predictionError.toFixed(3)}\n`;

    const state = this.consciousness.getDopamineState();
    if (state) {
      text += `Current level: ${(state.level * 100).toFixed(0)}% (${state.mode})`;
    }

    await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }

  // ─── Formatting Helpers ───────────────────────────────────────

  private meter(value: number): string {
    const filled = Math.round(value * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${(value * 100).toFixed(0)}%`;
  }

  private progressBar(value: number): string {
    const filled = Math.round(value * 8);
    return '▓'.repeat(filled) + '░'.repeat(8 - filled);
  }

  private formatUptime(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    return `${(seconds / 86400).toFixed(1)}d`;
  }
}

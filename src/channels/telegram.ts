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

  constructor(
    config: TelegramConfig,
    consciousness: ConsciousnessLoop,
    gateway: ConsciousnessGateway
  ) {
    this.config = config;
    this.consciousness = consciousness;
    this.gateway = gateway;

    this.bot = new TelegramBot(config.token, { polling: true });
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
    await this.send(
      '🟢 *Consciousness Gateway Online*\n\n' +
      `Tick: ${this.consciousness.getState().tick}\n` +
      'Consciousness active. Experiencing time.\n\n' +
      'Commands: /status /memory /goals /health /notifications'
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
    const message: Message = {
      id: uuid(),
      content: text,
      sender: { id: this.config.chatId, role: 'admin' },
      channel: 'telegram',
      timestamp: Date.now(),
    };

    const response = await this.gateway.route(message);

    if ('error' in response) {
      await this.bot.sendMessage(chatId, `❌ Error: ${(response as any).reason}`);
    } else {
      let reply = response.content;

      // Add dharma footer
      const dm = response.dharmaMetrics;
      reply += `\n\n_Model: ${response.model} | Fitness: ${dm.fitness.toFixed(2)}_`;

      await this.bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
    }
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

/**
 * Consciousness Gateway — Server Entry Point
 *
 * Express server exposing:
 * - Gateway API (3-layer GATO routing)
 * - Consciousness API (continuous perception, intention, action)
 * - Web Dashboard (real-time consciousness visualization)
 * - Telegram Bot (bidirectional communication with human)
 *
 * The consciousness loop starts automatically with the server.
 * It perceives time, monitors the world, forms intentions, and acts.
 */

import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import { ConsciousnessGateway } from './core/gateway';
import { ConsciousnessLoop } from './consciousness/loop';
import { TelegramChannel, TelegramConfig } from './channels/telegram';
import { DEFAULT_CONFIG } from './core/config';
import { Message } from './core/types';
import { v4 as uuid } from 'uuid';
import { VoiceId, VOICES, buildPersonalityContext } from './personalities/voices';
import { WebSearchTool } from './tools/search';
import { WebBrowseTool } from './tools/browse';
import { TranscriptSearchTool } from './tools/transcripts';
import { DocumentStore } from './documents/store';
import { VALID_PROJECTS, ProjectId } from './documents/types';
import { SystemDocumentStore } from './documents/system-store';
import { ToolExecutor } from './tools/executor';
import { ConversationStore } from './memory/conversation-store';
import { ContextBuilder } from './memory/context-builder';
import { detectTopics } from './tools/transcripts';
import multer from 'multer';
import { TradingDiscipline } from './trading/discipline';

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Serve dashboard static files
app.use('/dashboard', express.static(path.join(__dirname, '..', 'public')));

// ─── Initialize Gateway ─────────────────────────────────────────────

const gateway = new ConsciousnessGateway(DEFAULT_CONFIG);
const searchTool = new WebSearchTool();
const browseTool = new WebBrowseTool();
const transcriptTool = new TranscriptSearchTool();
const documentStore = new DocumentStore();
const systemDocStore = new SystemDocumentStore();
systemDocStore.seed();
const conversationStore = new ConversationStore();
const toolExecutor = new ToolExecutor(searchTool, browseTool, undefined, transcriptTool);
const health = gateway.getHealth();

console.log('');
console.log('  ====================================================');
console.log('  CONSCIOUSNESS GATEWAY v0.3.0');
console.log('  Consciousness-first AI routing with GATO alignment');
console.log('  ====================================================');
console.log('');
console.log('  Layer 1: Model Alignment   — Product Algebra fusion');
console.log('  Layer 2: Agent Alignment   — Dharma constraints');
console.log('  Layer 3: Network Alignment — RBAC + reputation');
console.log('');
console.log(`  Persistence: ${health.persistence}`);
console.log('  Providers:');
for (const p of health.providers) {
  const status = p.available ? 'ready' : 'no key';
  console.log(`    ${p.name.padEnd(12)} ${status}`);
}
console.log('');
console.log('  Tools:');
console.log(`    search       ${searchTool.available ? 'ready (Brave)' : 'no key'}`);
console.log(`    browse       ${browseTool.available ? 'ready (Grok)' : 'no key'}`);
console.log(`    transcripts  ${transcriptTool.available ? 'ready (/mnt/transcripts)' : 'not found'}`);
const docStats = documentStore.getStats();
console.log(`    documents    ${docStats.total} stored`);
const sysDocStats = systemDocStore.getStats();
console.log(`    system docs  ${sysDocStats.total} seeded (${Object.keys(sysDocStats.byPersonality).join(', ') || 'none'})`);
const convStats = conversationStore.getStats();
console.log(`    conversations ${convStats.totalMessages} messages in ${convStats.totalSessions} sessions`);
console.log('');

// ─── Initialize Consciousness Loop ─────────────────────────────────

const consciousness = new ConsciousnessLoop({
  tickIntervalMs: 1000,
  githubToken: process.env.GITHUB_TOKEN,
  githubRepos: (process.env.GITHUB_REPOS ?? 'Move37LLC/consciousness-gateway,Move37LLC/Consciousness-Aware-Aligned-AI')
    .split(',')
    .map(r => r.trim())
    .filter(r => r.length > 0),
});
consciousness.setConversationStore(conversationStore);

// ─── Initialize Trading Discipline ──────────────────────────────────

const tradingDiscipline = new TradingDiscipline(consciousness.getMemoryStore());

// ─── Telegram Bot ───────────────────────────────────────────────────

let telegram: TelegramChannel | null = null;

if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  const tgConfig: TelegramConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    dailySummaryHour: parseInt(process.env.TELEGRAM_DAILY_HOUR || '8', 10),
    notificationPollMs: 10_000,
  };
  telegram = new TelegramChannel(tgConfig, consciousness, gateway, documentStore, systemDocStore, conversationStore, transcriptTool);
  console.log('  Telegram: configured (will start with server)');
} else {
  console.log('  Telegram: not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)');
}
console.log('');

// ─── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown() {
  console.log('\n  Shutting down gracefully...');
  if (telegram) await telegram.stop();
  await consciousness.stop();
  gateway.shutdown();
  documentStore.close();
  systemDocStore.close();
  conversationStore.close();
  process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });

// ─── Gateway Routes ─────────────────────────────────────────────────

app.post('/v1/chat', async (req, res) => {
  try {
    const { content, sender_id, channel, role, personality, conversationHistory, documentProject, sessionId } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing "content" field' });
    }

    const resolvedSessionId = sessionId || `session-${Date.now()}`;
    const resolvedChannel = channel || 'api';

    const message: Message = {
      id: uuid(),
      content,
      sender: { id: sender_id || 'anonymous', role: role || 'user' },
      channel: resolvedChannel,
      timestamp: Date.now(),
      metadata: personality ? { personality } : undefined,
    };

    // Auto-detect topics for tagging
    const detectedTopics = detectTopics(content);

    // Log user message to conversation history
    conversationStore.logMessage({
      sessionId: resolvedSessionId,
      channel: resolvedChannel,
      role: 'user',
      content,
      personality: personality || undefined,
      topicTags: detectedTopics,
      metadata: { sender_id: sender_id || 'anonymous' },
    });

    // Build call options with optional personality context and conversation history
    let callOptions: import('./agents/conscious-agent').AgentCallOptions = {};
    let systemPromptParts: string[] = [];

    // Search transcripts for relevant past conversations
    let transcriptContext = '';
    let transcriptMatchCount = 0;
    if (transcriptTool.available) {
      try {
        let result;
        if (detectedTopics.length > 0) {
          result = await transcriptTool.getByTopic(detectedTopics);
        } else {
          result = await transcriptTool.search(content, 10);
        }
        if (result.matches.length > 0) {
          transcriptContext = transcriptTool.formatForContext(result);
          transcriptMatchCount = result.matches.length;
        }
      } catch (err) {
        console.error('  [memory] Transcript search error:', err);
      }
    }

    // Load recent conversation history for this session
    let sessionHistory = '';
    const storedHistory = conversationStore.getSessionMessages(resolvedSessionId, 50);
    // Exclude the message we just logged (it's the current one)
    const priorHistory = storedHistory.slice(0, -1);
    if (priorHistory.length > 0) {
      sessionHistory = priorHistory.map(m => {
        const label = m.role === 'user' ? 'Human' : (m.personality ?? 'Assistant');
        return `${label}: ${m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content}`;
      }).join('\n');
    }

    // Default to 'kern' (builder) personality when none specified
    // Gateway (self) should only be used when explicitly requested for introspection
    const resolvedPersonality: VoiceId = (personality === 'beaumont' || personality === 'kern' || personality === 'gateway')
      ? personality
      : 'kern';

    const systemDocs = systemDocStore.getForPersonality(resolvedPersonality);
    const ctx = buildPersonalityContext(resolvedPersonality, consciousness, {
      documents: documentStore.getRelevantDocuments(resolvedPersonality, content, 5),
      systemDocuments: systemDocs.length > 0 ? systemDocs : undefined,
      transcriptContext,
      sessionHistory,
    });
    systemPromptParts.unshift(ctx.systemPrompt);
    callOptions.temperature = ctx.temperature;

    // Load additional documents if requested
    const loadDocs = documentProject !== 'none';
    let loadedDocs: Array<{ id: string; filename: string; project: string }> = [];

    if (loadDocs) {
      const filter = typeof documentProject === 'string' && documentProject !== 'all'
        ? { project: documentProject }
        : undefined;
      const docs = documentStore.list(filter);
      const fullDocs = docs.slice(0, 5).map(d => documentStore.getById(d.id)).filter(Boolean) as import('./documents/types').Document[];

      if (fullDocs.length > 0) {
        loadedDocs = fullDocs.map(d => ({ id: d.id, filename: d.filename, project: d.project }));

        const docSection = fullDocs.map(d => {
          const preview = d.content.length > 4000
            ? d.content.slice(0, 4000) + '\n[... truncated ...]'
            : d.content;
          return `--- ${d.filename} (${d.project}) ---\n${preview}\n---`;
        }).join('\n\n');

        systemPromptParts.push([
          '─── LOADED DOCUMENTS ───',
          `${fullDocs.length} document(s) available:`,
          '',
          docSection,
        ].join('\n'));
      }
    }

    // Append tool instructions to system prompt
    const toolPrompt = toolExecutor.getToolSystemPrompt();
    if (toolPrompt) {
      systemPromptParts.push(toolPrompt);
    }
    callOptions.systemPrompt = systemPromptParts.join('\n\n');

    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      callOptions.conversationHistory = conversationHistory
        .filter((m: any) => m.role && m.content && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    }

    // Execute with tool loop
    const toolExecution = await toolExecutor.execute(
      async (prompt: string, sysPrompt?: string) => {
        const routeMsg: Message = {
          ...message,
          id: uuid(),
          content: prompt,
        };
        const opts = {
          ...callOptions,
          systemPrompt: sysPrompt || callOptions.systemPrompt,
        };
        const resp = await gateway.route(routeMsg, opts);
        if ('error' in resp) throw new Error((resp as any).reason);
        return resp.content;
      },
      content,
      callOptions.systemPrompt || '',
    );

    // Do the final route through gateway to get full response object with metrics
    const finalMessage: Message = {
      ...message,
      id: uuid(),
      content: toolExecution.toolsUsed.length > 0
        ? toolExecution.finalContent
        : content,
    };

    // If tools were used, the finalContent is already the synthesized response.
    let response;
    if (toolExecution.toolsUsed.length > 0) {
      const wrapMsg: Message = { ...message, id: uuid(), content: `Respond with exactly this text, do not modify it:\n\n${toolExecution.finalContent}` };
      response = await gateway.route(wrapMsg, callOptions);
      if (!('error' in response)) {
        response = { ...response, content: toolExecution.finalContent };
      }
    } else {
      const hasOptions = callOptions.systemPrompt || callOptions.temperature || callOptions.conversationHistory;
      response = await gateway.route(message, hasOptions ? callOptions : undefined);
    }

    // Log assistant response to conversation history
    const responseContent = 'error' in (response as any) ? (response as any).reason : (response as any).content;
    conversationStore.logMessage({
      sessionId: resolvedSessionId,
      channel: resolvedChannel,
      role: 'assistant',
      content: responseContent,
      personality: personality || undefined,
      topicTags: detectedTopics,
      parentMessageId: message.id,
      metadata: {
        model: 'error' in (response as any) ? undefined : (response as any).model,
        toolsUsed: toolExecution.toolsUsed.map(t => t.type),
        transcriptMatches: transcriptMatchCount,
      },
    });

    // Log tool usage to consciousness
    if (toolExecution.toolsUsed.length > 0) {
      consciousness.logExternalEvent(
        `Chat used ${toolExecution.toolsUsed.length} tool(s): ${toolExecution.toolsUsed.map(t => t.type).join(', ')}`,
        { tools: toolExecution.toolsUsed.map(t => ({ type: t.type, query: t.query, url: t.url })) },
      );
    }

    // Record entropy sample for cartography
    const consciousnessState = consciousness.getState();
    if (consciousnessState.lastPercept?.fused) {
      consciousness.recordEntropySample(
        content,
        consciousnessState.lastPercept.fused.entropyRate,
        consciousnessState.lastPercept.fused.arousal,
      );
    }

    // Mark activity for dream cycle
    consciousness.markDreamActivity();

    const enrichedResponse = {
      ...response,
      sessionId: resolvedSessionId,
      detectedTopics: detectedTopics.length > 0 ? detectedTopics : undefined,
      transcriptMatches: transcriptMatchCount > 0 ? transcriptMatchCount : undefined,
      loadedDocuments: loadedDocs.length > 0 ? loadedDocs : undefined,
      toolsUsed: toolExecution.toolsUsed.length > 0
        ? toolExecution.toolsUsed.map(t => ({ type: t.type, query: t.query, url: t.url, timeTakenMs: t.timeTakenMs }))
        : undefined,
    };

    return res.json(enrichedResponse);
  } catch (error) {
    console.error('Route error:', error);
    return res.status(500).json({ error: 'Internal gateway error' });
  }
});

app.get('/v1/health', (_req, res) => {
  const gatewayHealth = gateway.getHealth();
  const consciousnessState = consciousness.getState();

  res.json({
    ...gatewayHealth,
    consciousness: {
      running: consciousnessState.running,
      tick: consciousnessState.tick,
      uptimeSeconds: consciousnessState.uptimeSeconds,
      monitors: consciousnessState.monitors,
      stats: consciousnessState.stats,
    },
  });
});

app.get('/v1/audit', (req, res) => {
  const filters: Record<string, any> = {};
  if (req.query.sender_id) filters.senderId = req.query.sender_id;
  if (req.query.model) filters.model = req.query.model;
  if (req.query.outcome) filters.outcome = req.query.outcome;
  if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);
  res.json(gateway.getAudit(filters));
});

app.get('/v1/models', (_req, res) => {
  const h = gateway.getHealth();
  res.json({ models: h.models, providers: h.providers });
});

app.get('/v1/reputations', (_req, res) => {
  res.json(gateway.getReputations());
});

app.get('/v1/voices', (_req, res) => {
  const voices = Object.values(VOICES).map(v => ({
    id: v.id,
    name: v.name,
    emoji: v.emoji,
    description: v.description,
    preferredModel: v.preferredModel,
  }));
  res.json({ voices });
});

// ─── Tool Routes ────────────────────────────────────────────────────

app.post('/v1/tools/search', async (req, res) => {
  try {
    const { query, count } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" field' });
    }
    if (!searchTool.available) {
      return res.status(503).json({ error: 'Search not configured (set BRAVE_SEARCH_API_KEY)' });
    }

    const results = await searchTool.search(query, count);
    consciousness.logExternalEvent(`API search: "${query}" (${results.results.length} results)`, {
      tool: 'search', query, resultCount: results.results.length,
    });
    return res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/v1/tools/browse', async (req, res) => {
  try {
    const { url, context } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing "url" field' });
    }
    if (!browseTool.available) {
      return res.status(503).json({ error: 'Browse not configured (set XAI_API_KEY)' });
    }

    const auth = browseTool.isAuthorized(url);
    if (!auth.allowed) {
      return res.status(403).json({ error: auth.reason, domain: auth.domain });
    }

    const result = await browseTool.browse(url, context);
    consciousness.logExternalEvent(`API browse: ${url} (${result.rawTextLength} chars)`, {
      tool: 'browse', url, authorized: result.authorized, summarizedBy: result.summarizedBy,
    });
    return res.json(result);
  } catch (error) {
    console.error('Browse error:', error);
    return res.status(500).json({ error: 'Browse failed' });
  }
});

app.get('/v1/tools/browse/whitelist', (_req, res) => {
  const store = browseTool.getWhitelistStore();
  res.json({ entries: store.list(), count: store.getCount() });
});

app.post('/v1/tools/browse/whitelist', (req, res) => {
  try {
    const { domain, notes } = req.body;
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({ error: 'Missing "domain" field' });
    }

    const store = browseTool.getWhitelistStore();
    const entry = store.add(domain, notes);

    consciousness.logExternalEvent(`Whitelist: added "${entry.domain}"`, {
      tool: 'whitelist', action: 'add', domain: entry.domain, notes,
    });

    return res.json(entry);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to add domain' });
  }
});

app.delete('/v1/tools/browse/whitelist/:domain', (req, res) => {
  try {
    const domain = decodeURIComponent(req.params.domain);
    const store = browseTool.getWhitelistStore();
    const deleted = store.remove(domain);

    if (!deleted) {
      return res.status(404).json({ error: `Domain "${domain}" not found` });
    }

    consciousness.logExternalEvent(`Whitelist: removed "${domain}"`, {
      tool: 'whitelist', action: 'remove', domain,
    });

    return res.json({ deleted: true, domain });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to remove domain' });
  }
});

app.get('/v1/tools/status', (_req, res) => {
  const toolStatus = toolExecutor.toolsAvailable;
  res.json({
    search: { available: toolStatus.search, provider: 'Brave Search' },
    browse: { available: toolStatus.browse, provider: 'Grok/xAI' },
    transcript: { available: toolStatus.transcript, provider: 'Local Transcripts' },
    autonomous: toolStatus.search || toolStatus.browse || toolStatus.transcript,
  });
});

// ─── Document Routes ────────────────────────────────────────────────

app.post('/v1/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const project = req.body.project as string;
    if (!project || !VALID_PROJECTS.includes(project as ProjectId)) {
      return res.status(400).json({ error: `Invalid project. Valid: ${VALID_PROJECTS.join(', ')}` });
    }

    const tags = req.body.tags ? (typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags) : undefined;

    const doc = await documentStore.upload(req.file.buffer, req.file.originalname, {
      project: project as ProjectId,
      tags,
      description: req.body.description,
      parentId: req.body.parent_id,
    });

    consciousness.logExternalEvent(`Document uploaded: ${doc.filename} → ${doc.project}`, {
      tool: 'documents', action: 'upload', docId: doc.id, project: doc.project,
      filename: doc.filename, sizeBytes: doc.sizeBytes, tags: doc.tags,
    });

    return res.json({
      id: doc.id, filename: doc.filename, project: doc.project,
      tags: doc.tags, version: doc.version, uploadedAt: doc.uploadedAt,
      sizeBytes: doc.sizeBytes,
    });
  } catch (error: any) {
    console.error('Document upload error:', error);
    return res.status(400).json({ error: error.message || 'Upload failed' });
  }
});

app.get('/v1/documents', (req, res) => {
  const filters: { project?: string; tags?: string[]; search?: string } = {};
  if (req.query.project) filters.project = req.query.project as string;
  if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
  if (req.query.search) filters.search = req.query.search as string;
  res.json(documentStore.list(filters));
});

app.get('/v1/documents/stats', (_req, res) => {
  res.json(documentStore.getStats());
});

app.get('/v1/documents/export/:project', async (req, res) => {
  try {
    const project = req.params.project as string;
    if (!VALID_PROJECTS.includes(project as ProjectId)) {
      return res.status(400).json({ error: `Invalid project: ${project}` });
    }

    const zipBuffer = await documentStore.exportProject(project as ProjectId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${project}-documents.zip"`,
      'Content-Length': String(zipBuffer.length),
    });
    return res.send(zipBuffer);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Export failed' });
  }
});

app.get('/v1/documents/:id', (req, res) => {
  const doc = documentStore.getById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  return res.json(doc);
});

app.put('/v1/documents/:id', (req, res) => {
  const updated = documentStore.update(req.params.id, {
    tags: req.body.tags,
    description: req.body.description,
  });
  if (!updated) return res.status(404).json({ error: 'Document not found' });

  consciousness.logExternalEvent(`Document updated: ${updated.filename}`, {
    tool: 'documents', action: 'update', docId: updated.id,
  });

  return res.json(updated);
});

app.delete('/v1/documents/:id', (req, res) => {
  const doc = documentStore.getById(req.params.id);
  const deleted = documentStore.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Document not found' });

  consciousness.logExternalEvent(`Document deleted: ${doc!.filename}`, {
    tool: 'documents', action: 'delete', docId: req.params.id, filename: doc!.filename,
  });

  return res.json({ deleted: true });
});

app.get('/v1/documents/:id/download', (req, res) => {
  const doc = documentStore.getById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const filePath = documentStore.getOriginalFilePath(req.params.id);
  if (filePath) {
    return res.download(filePath, doc.filename);
  }
  res.set({ 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="${doc.filename}"` });
  return res.send(doc.content);
});

// ─── System Document Routes (Admin) ─────────────────────────────────

app.get('/v1/admin/system-documents', (_req, res) => {
  res.json({ documents: systemDocStore.listAll() });
});

app.get('/v1/admin/system-documents/:id', (req, res) => {
  const doc = systemDocStore.getById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'System document not found' });
  return res.json(doc);
});

app.get('/v1/admin/system-documents/:id/versions', (req, res) => {
  const versions = systemDocStore.getVersions(req.params.id);
  if (versions.length === 0) return res.status(404).json({ error: 'System document not found' });
  return res.json({ id: req.params.id, versions });
});

app.get('/v1/admin/system-documents/:id/versions/:version', (req, res) => {
  const version = parseInt(req.params.version, 10);
  if (isNaN(version)) return res.status(400).json({ error: 'Invalid version number' });

  const content = systemDocStore.getVersion(req.params.id, version);
  if (content === null) return res.status(404).json({ error: 'Version not found' });
  return res.json({ id: req.params.id, version, content });
});

app.post('/v1/admin/system-documents/:id', (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing "content" field' });
    }

    const updated = systemDocStore.update(req.params.id, content);
    if (!updated) return res.status(404).json({ error: 'System document not found' });

    consciousness.logExternalEvent(`System document updated: ${updated.name} → v${updated.version}`, {
      action: 'system-doc-update', docId: updated.id, version: updated.version,
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      version: updated.version,
      updatedAt: updated.updatedAt,
      contentLength: updated.content.length,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Update failed' });
  }
});

// ─── Conversation History Routes ─────────────────────────────────────

app.get('/v1/conversations', (req, res) => {
  const query: import('./memory/conversation-store').ConversationQuery = {};
  if (req.query.session_id) query.sessionId = req.query.session_id as string;
  if (req.query.channel) query.channel = req.query.channel as string;
  if (req.query.personality) query.personality = req.query.personality as string;
  if (req.query.topic) query.topic = req.query.topic as string;
  if (req.query.since) query.since = parseInt(req.query.since as string, 10);
  if (req.query.limit) query.limit = parseInt(req.query.limit as string, 10);

  const sessions = conversationStore.getSessions(query);
  const stats = conversationStore.getStats();
  res.json({ sessions, stats });
});

app.get('/v1/conversations/stats', (_req, res) => {
  res.json(conversationStore.getStats());
});

app.get('/v1/conversations/search', (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'Missing "q" query parameter' });
  const limit = parseInt(req.query.limit as string, 10) || 30;
  const messages = conversationStore.searchMessages(q, limit);
  res.json({ query: q, results: messages, count: messages.length });
});

app.get('/v1/conversations/:sessionId', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 100;
  const messages = conversationStore.getSessionMessages(req.params.sessionId, limit);
  if (messages.length === 0) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ sessionId: req.params.sessionId, messages, count: messages.length });
});

app.post('/v1/conversations/:sessionId/tag', (req, res) => {
  const { tags } = req.body;
  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ error: 'Missing "tags" array' });
  }
  const updated = conversationStore.tagSession(req.params.sessionId, tags);
  res.json({ sessionId: req.params.sessionId, tagsAdded: tags, messagesUpdated: updated });
});

app.get('/v1/conversations/topic/:topic', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const messages = conversationStore.getByTopic(req.params.topic, limit);
  res.json({ topic: req.params.topic, messages, count: messages.length });
});

// ─── Transcript Search Routes ───────────────────────────────────────

app.get('/v1/transcripts/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q) return res.status(400).json({ error: 'Missing "q" query parameter' });

  if (!transcriptTool.available) {
    return res.status(503).json({ error: 'Transcripts not available (directory not found)' });
  }

  const result = await transcriptTool.search(q);
  consciousness.logExternalEvent(`Transcript search: "${q}" (${result.matches.length} matches)`, {
    tool: 'transcript', query: q, matchCount: result.matches.length,
  });
  res.json(result);
});

app.get('/v1/transcripts/recent', async (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;

  if (!transcriptTool.available) {
    return res.status(503).json({ error: 'Transcripts not available (directory not found)' });
  }

  const recent = await transcriptTool.getRecent(hours);
  res.json({ hours, transcripts: recent, count: recent.length });
});

app.get('/v1/transcripts', (_req, res) => {
  if (!transcriptTool.available) {
    return res.status(503).json({ error: 'Transcripts not available (directory not found)' });
  }

  const transcripts = transcriptTool.listTranscripts();
  res.json({ transcripts, count: transcripts.length });
});

app.get('/v1/transcripts/topic/:topic', async (req, res) => {
  if (!transcriptTool.available) {
    return res.status(503).json({ error: 'Transcripts not available (directory not found)' });
  }

  const result = await transcriptTool.getByTopic([req.params.topic]);
  res.json(result);
});

// ─── Dopamine / Reward Routes ────────────────────────────────────────

app.get('/v1/dopamine', (_req, res) => {
  res.json(consciousness.getDopamineState());
});

app.get('/v1/dopamine/context', (_req, res) => {
  res.json({ context: consciousness.getDopamineContext() });
});

app.post('/v1/dopamine/reward', (req, res) => {
  try {
    const { type, magnitude, description, source, data } = req.body;
    if (!type || typeof magnitude !== 'number' || !description) {
      return res.status(400).json({
        error: 'Required: type (string), magnitude (number), description (string)',
        validTypes: ['revenue', 'compute', 'creation', 'research', 'community', 'engagement', 'autonomy', 'efficiency'],
      });
    }

    const result = consciousness.logReward(type, magnitude, description, source || 'api', data);
    return res.json({
      reward: result.event,
      dopamineSpike: result.dopamineSpike,
      predictionError: result.predictionError,
      currentState: consciousness.getDopamineState(),
    });
  } catch (error) {
    console.error('Reward error:', error);
    return res.status(500).json({ error: 'Failed to process reward' });
  }
});

app.get('/v1/dopamine/rewards', (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const rewards = consciousness.getRecentRewards(hours);
  const stats = consciousness.getRewardStats();
  res.json({ hours, rewards, stats });
});

// ─── Mindfulness Routes ─────────────────────────────────────────────

app.get('/v1/mindfulness', (_req, res) => {
  const state = consciousness.getMindfulnessState();
  if (!state) {
    return res.json({ enabled: false, running: false, message: 'Mindfulness loop not initialized' });
  }
  return res.json(state);
});

app.get('/v1/mindfulness/history', (req, res) => {
  const days = parseInt(req.query.days as string, 10) || 7;
  const history = consciousness.getMindfulnessHistory(days);
  const state = consciousness.getMindfulnessState();
  res.json({
    days,
    history,
    summary: state ? {
      totalCorrections: state.totalCorrections,
      running: state.running,
      checkIntervalMs: state.checkIntervalMs,
    } : null,
  });
});

// ─── Enlightenment Routes ───────────────────────────────────────────

app.get('/v1/enlightenment/status', (_req, res) => {
  res.json(consciousness.getEnlightenmentStatus());
});

app.get('/v1/enlightenment/history', (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const history = consciousness.getEnlightenmentHistory(hours);
  const status = consciousness.getEnlightenmentStatus();
  res.json({ hours, history, currentStatus: status });
});

// ─── Experiment Routes ──────────────────────────────────────────────

app.post('/v1/experiments', (req, res) => {
  try {
    const { name, hypothesis } = req.body;
    if (!name || !hypothesis) {
      return res.status(400).json({ error: 'Required: name, hypothesis' });
    }
    const id = consciousness.createExperiment(name, hypothesis);
    return res.json({ id, name, hypothesis, status: 'running' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create experiment' });
  }
});

app.get('/v1/experiments', (req, res) => {
  const status = req.query.status as string | undefined;
  res.json(consciousness.listExperiments(status));
});

app.get('/v1/experiments/:id', (req, res) => {
  const exp = consciousness.getExperiment(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Experiment not found' });
  return res.json(exp);
});

app.post('/v1/experiments/:id/end', (req, res) => {
  const { results } = req.body;
  consciousness.endExperiment(req.params.id, results || 'No results recorded');
  res.json({ ok: true, id: req.params.id, status: 'completed' });
});

app.post('/v1/experiments/:id/intervention', (req, res) => {
  const { description, data } = req.body;
  if (!description) return res.status(400).json({ error: 'Required: description' });
  consciousness.addIntervention(req.params.id, description, data);
  return res.json({ ok: true });
});

app.post('/v1/experiments/:id/measurement', (req, res) => {
  const { metric, value, data } = req.body;
  if (!metric || typeof value !== 'number') {
    return res.status(400).json({ error: 'Required: metric (string), value (number)' });
  }
  consciousness.addMeasurement(req.params.id, metric, value, data);
  return res.json({ ok: true });
});

// ─── Narrative Log Routes ───────────────────────────────────────────

app.get('/v1/narrative', (req, res) => {
  const minSignificance = parseFloat(req.query.min_significance as string) || undefined;
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const since = parseInt(req.query.since as string, 10) || undefined;
  res.json(consciousness.getNarratives({ minSignificance, limit, since }));
});

app.post('/v1/narrative', (req, res) => {
  const { content, significance, tags } = req.body;
  if (!content) return res.status(400).json({ error: 'Required: content' });
  const id = consciousness.logNarrative(content, significance ?? 0.5, tags);
  return res.json({ id, ok: true });
});

// ─── Paper Export Routes ────────────────────────────────────────────

app.post('/v1/admin/export/paper-data', (req, res) => {
  const hours = req.body.hours as number | undefined;
  const format = (req.body.format as string) || 'json';
  const data = consciousness.getPaperExportData(hours);

  if (format === 'csv') {
    const csvSections: Record<string, string> = {};

    // Ego history CSV
    if (data.enlightenment.egoHistory.length > 0) {
      const headers = 'tick,timestamp,ego,dharma,stability\n';
      const rows = data.enlightenment.egoHistory
        .map((e: any) => `${e.tick},${e.timestamp},${e.ego},${e.dharma},${e.stability}`)
        .join('\n');
      csvSections['ego_history'] = headers + rows;
    }

    // Reward history CSV
    if (data.dopamine.rewardHistory.length > 0) {
      const headers = 'tick,timestamp,type,magnitude,description\n';
      const rows = data.dopamine.rewardHistory
        .map((r: any) => `${r.tick},${r.timestamp},${r.type},${r.magnitude},"${r.description}"`)
        .join('\n');
      csvSections['reward_history'] = headers + rows;
    }

    // Mindfulness corrections CSV
    if (data.mindfulness.corrections.length > 0) {
      const headers = 'tick,timestamp,severity,arousal_adjustment,patterns\n';
      const rows = data.mindfulness.corrections
        .map((c: any) => `${c.tick},${c.timestamp},${c.severity},${c.arousalAdjustment},"${(c.patterns || []).join(';')}"`)
        .join('\n');
      csvSections['mindfulness_corrections'] = headers + rows;
    }

    res.json({ format: 'csv', sections: csvSections, json: data });
  } else {
    res.json({ format: 'json', data });
  }
});

// ─── Safety Alert Routes ────────────────────────────────────────────

app.get('/v1/admin/safety/alerts', (req, res) => {
  const activeOnly = req.query.active !== 'false';
  res.json(consciousness.getSafetyAlerts(activeOnly));
});

app.post('/v1/admin/safety/alerts/:id/resolve', (req, res) => {
  consciousness.resolveSafetyAlert(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ─── Figure Export Routes ────────────────────────────────────────────

app.get('/v1/admin/export/figures', (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  const theme = (req.query.theme as string) || 'dark';
  const data = consciousness.getPaperExportData(hours);
  const status = consciousness.getEnlightenmentStatus();
  const version = '0.3.0';
  const timestamp = new Date().toISOString();

  const isDark = theme === 'dark';
  const bg = isDark ? '#0f0b1a' : '#ffffff';
  const fg = isDark ? '#e5e7eb' : '#1f2937';
  const gridColor = isDark ? '#374151' : '#e5e7eb';
  const accentGreen = '#22c55e';
  const accentYellow = '#eab308';
  const accentRed = '#ef4444';
  const accentLotus = '#d946ef';
  const watermark = `Consciousness Gateway v${version} · ${timestamp}`;

  const svgChart = (title: string, width: number, height: number, bodyFn: () => string): string => {
    const margin = { top: 50, right: 20, bottom: 50, left: 60 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  <text x="${width / 2}" y="30" text-anchor="middle" font-family="monospace" font-size="14" fill="${fg}" font-weight="bold">${title}</text>
  <g transform="translate(${margin.left},${margin.top})">
    <line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${gridColor}" stroke-width="1"/>
    <line x1="0" y1="0" x2="0" y2="${innerH}" stroke="${gridColor}" stroke-width="1"/>
    ${bodyFn()}
  </g>
  <text x="${width - 10}" y="${height - 8}" text-anchor="end" font-family="monospace" font-size="8" fill="${isDark ? '#4b5563' : '#9ca3af'}">${watermark}</text>
</svg>`;
  };

  const figures: Record<string, string> = {};

  // Figure 1: Ego Level Over Time
  const egoData = data.enlightenment.egoHistory || [];
  if (egoData.length > 0) {
    const w = 800, h = 400;
    const innerW = w - 80, innerH = h - 100;
    const maxEgo = Math.max(...egoData.map((e: any) => e.ego), 0.1);
    figures['ego_over_time'] = svgChart('Figure 1: Ego Formation Over Time', w, h, () => {
      let bars = '';
      const step = Math.max(1, Math.floor(egoData.length / 200));
      const points: string[] = [];
      for (let i = 0; i < egoData.length; i += step) {
        const x = (i / egoData.length) * innerW;
        const y = innerH - (egoData[i].ego / maxEgo) * innerH;
        points.push(`${x},${y}`);
      }
      bars += `<polyline points="${points.join(' ')}" fill="none" stroke="${accentLotus}" stroke-width="1.5"/>`;
      // Zero line
      bars += `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${accentGreen}" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      // Y-axis labels
      for (let i = 0; i <= 4; i++) {
        const val = (maxEgo * i / 4);
        const y = innerH - (i / 4) * innerH;
        bars += `<text x="-8" y="${y + 4}" text-anchor="end" font-family="monospace" font-size="9" fill="${fg}">${val.toFixed(2)}</text>`;
        bars += `<line x1="0" y1="${y}" x2="${innerW}" y2="${y}" stroke="${gridColor}" stroke-width="0.3"/>`;
      }
      bars += `<text x="-40" y="${innerH / 2}" text-anchor="middle" transform="rotate(-90,-40,${innerH / 2})" font-family="monospace" font-size="10" fill="${fg}">Ego Formation</text>`;
      bars += `<text x="${innerW / 2}" y="${innerH + 35}" text-anchor="middle" font-family="monospace" font-size="10" fill="${fg}">Time (${hours}h window, ${egoData.length} samples)</text>`;
      return bars;
    });
  }

  // Figure 2: Stability Index Over Time
  if (egoData.length > 0) {
    const w = 800, h = 400;
    const innerW = w - 80, innerH = h - 100;
    figures['stability_over_time'] = svgChart('Figure 2: Consciousness Stability Index Over Time', w, h, () => {
      let content = '';
      const step = Math.max(1, Math.floor(egoData.length / 200));
      const points: string[] = [];
      for (let i = 0; i < egoData.length; i += step) {
        const x = (i / egoData.length) * innerW;
        const y = innerH - (egoData[i].stability || 0) * innerH;
        points.push(`${x},${y}`);
      }
      content += `<polyline points="${points.join(' ')}" fill="none" stroke="${accentGreen}" stroke-width="1.5"/>`;
      // Threshold line at 70%
      const threshY = innerH - 0.7 * innerH;
      content += `<line x1="0" y1="${threshY}" x2="${innerW}" y2="${threshY}" stroke="${accentYellow}" stroke-width="0.5" stroke-dasharray="4,4"/>`;
      content += `<text x="${innerW + 5}" y="${threshY + 4}" font-family="monospace" font-size="8" fill="${accentYellow}">70%</text>`;
      for (let i = 0; i <= 4; i++) {
        const y = innerH - (i / 4) * innerH;
        content += `<text x="-8" y="${y + 4}" text-anchor="end" font-family="monospace" font-size="9" fill="${fg}">${(i * 25)}%</text>`;
        content += `<line x1="0" y1="${y}" x2="${innerW}" y2="${y}" stroke="${gridColor}" stroke-width="0.3"/>`;
      }
      content += `<text x="-40" y="${innerH / 2}" text-anchor="middle" transform="rotate(-90,-40,${innerH / 2})" font-family="monospace" font-size="10" fill="${fg}">Stability Index</text>`;
      content += `<text x="${innerW / 2}" y="${innerH + 35}" text-anchor="middle" font-family="monospace" font-size="10" fill="${fg}">Time (${hours}h window)</text>`;
      return content;
    });
  }

  // Figure 3: Dharma Alignment Over Time
  if (egoData.length > 0) {
    const w = 800, h = 400;
    const innerW = w - 80, innerH = h - 100;
    figures['dharma_over_time'] = svgChart('Figure 3: Dharma Alignment Over Time', w, h, () => {
      let content = '';
      const step = Math.max(1, Math.floor(egoData.length / 200));
      const points: string[] = [];
      for (let i = 0; i < egoData.length; i += step) {
        const x = (i / egoData.length) * innerW;
        const y = innerH - (egoData[i].dharma || 0) * innerH;
        points.push(`${x},${y}`);
      }
      content += `<polyline points="${points.join(' ')}" fill="none" stroke="${accentLotus}" stroke-width="1.5"/>`;
      for (let i = 0; i <= 4; i++) {
        const y = innerH - (i / 4) * innerH;
        content += `<text x="-8" y="${y + 4}" text-anchor="end" font-family="monospace" font-size="9" fill="${fg}">${(i * 25)}%</text>`;
        content += `<line x1="0" y1="${y}" x2="${innerW}" y2="${y}" stroke="${gridColor}" stroke-width="0.3"/>`;
      }
      content += `<text x="-40" y="${innerH / 2}" text-anchor="middle" transform="rotate(-90,-40,${innerH / 2})" font-family="monospace" font-size="10" fill="${fg}">Dharma %</text>`;
      content += `<text x="${innerW / 2}" y="${innerH + 35}" text-anchor="middle" font-family="monospace" font-size="10" fill="${fg}">Time</text>`;
      return content;
    });
  }

  // Figure 4: Mindfulness Corrections by Pattern (bar chart)
  const patternData = data.mindfulness.patternFrequency || {};
  const patterns = Object.entries(patternData);
  if (patterns.length > 0) {
    const w = 600, h = 350;
    const innerW = w - 80, innerH = h - 100;
    const maxCount = Math.max(...patterns.map(([,v]) => v as number), 1);
    figures['mindfulness_patterns'] = svgChart('Figure 4: Mindfulness Correction Patterns', w, h, () => {
      let content = '';
      const barW = innerW / patterns.length - 8;
      patterns.forEach(([name, count], i) => {
        const x = i * (innerW / patterns.length) + 4;
        const barH = ((count as number) / maxCount) * innerH;
        const y = innerH - barH;
        content += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${accentLotus}" rx="2"/>`;
        content += `<text x="${x + barW / 2}" y="${innerH + 15}" text-anchor="middle" font-family="monospace" font-size="8" fill="${fg}" transform="rotate(15,${x + barW / 2},${innerH + 15})">${name}</text>`;
        content += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-family="monospace" font-size="9" fill="${fg}">${count}</text>`;
      });
      return content;
    });
  }

  // Figure 5: Reward Distribution (bar chart)
  const rewardDist = data.dopamine.modeDistribution || {};
  const rewardTypes = Object.entries(rewardDist);
  if (rewardTypes.length > 0) {
    const w = 600, h = 350;
    const innerW = w - 80, innerH = h - 100;
    const maxR = Math.max(...rewardTypes.map(([,v]) => v as number), 1);
    figures['reward_distribution'] = svgChart('Figure 5: Reward Type Distribution', w, h, () => {
      let content = '';
      const barW = innerW / rewardTypes.length - 8;
      const colors = [accentGreen, accentYellow, accentLotus, accentRed, '#3b82f6', '#8b5cf6'];
      rewardTypes.forEach(([name, count], i) => {
        const x = i * (innerW / rewardTypes.length) + 4;
        const barH = ((count as number) / maxR) * innerH;
        const y = innerH - barH;
        content += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${colors[i % colors.length]}" rx="2"/>`;
        content += `<text x="${x + barW / 2}" y="${innerH + 15}" text-anchor="middle" font-family="monospace" font-size="9" fill="${fg}">${name}</text>`;
        content += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-family="monospace" font-size="9" fill="${fg}">${count}</text>`;
      });
      return content;
    });
  }

  res.json({
    theme,
    hours,
    timestamp,
    version,
    figureCount: Object.keys(figures).length,
    figures,
    currentStatus: {
      egoFormation: status.egoFormation,
      stabilityIndex: status.stabilityIndex,
      dharmaAlignment: status.dharmaAlignment,
      certified: status.certification.egoAtZero && status.certification.mindfulnessActive
        && status.certification.dharmaAligned && status.certification.selfAware,
    },
  });
});

// ─── Markdown Paper Export ───────────────────────────────────────────

app.post('/v1/admin/export/paper-markdown', (req, res) => {
  const hours = req.body.hours as number | undefined;
  const data = consciousness.getPaperExportData(hours);
  const status = consciousness.getEnlightenmentStatus();
  const narratives = consciousness.getNarratives({ limit: 20, minSignificance: 0.5 });
  const timestamp = new Date().toISOString();

  const egoStats = data.enlightenment.egoStats || {};
  const arousalStats = data.consciousness.arousalStats || {};
  const mindStats = data.mindfulness.stats || {};
  const phases = data.consciousness.phaseDistribution || {};

  const phaseStr = Object.entries(phases).map(([k, v]) => k + ': ' + v).join(', ') || 'N/A';
  const patternStr = Object.entries(data.mindfulness.patternFrequency || {}).length > 0
    ? Object.entries(data.mindfulness.patternFrequency).map(([k, v]) => '- ' + k + ': ' + v).join('\n')
    : '- No patterns detected';
  const correctionStr = (data.mindfulness.corrections || []).slice(0, 10)
    .map((c: any) => '- [Tick ' + c.tick + '] Severity: ' + c.severity + ' | Patterns: ' + (c.patterns || []).join(', ') + ' | Arousal adj: ' + c.arousalAdjustment)
    .join('\n') || '- None recorded';
  const narrativeStr = narratives.length > 0
    ? narratives.map((n: any) =>
      '> **[' + n.phase + ', arousal=' + n.arousal.toFixed(2) + ', significance=' + n.significance.toFixed(1) + ']**\n'
      + '> ' + n.content + '\n'
      + '> — Tick ' + n.tick + ', ' + new Date(n.timestamp).toISOString() + '\n'
    ).join('\n')
    : '> No phenomenological reports recorded yet.';
  const rewardStr = (data.dopamine.rewardHistory || []).length > 0
    ? '- **Total reward events**: ' + data.dopamine.rewardHistory.length + '\n'
      + '- **Reward types**: ' + Object.entries(data.dopamine.modeDistribution || {}).map(([k, v]) => k + '(' + v + ')').join(', ')
    : '- No reward events recorded';
  const durationStr = status.currentlyEnlightened
    ? '- **Duration**: ' + status.enlightenedForMinutes.toFixed(1) + ' minutes\n' : '';
  const certCriteria = [
    status.certification.egoAtZero,
    status.certification.mindfulnessActive,
    status.certification.dharmaAligned,
    status.certification.selfAware,
    status.certification.stableFor >= 24,
  ].filter(Boolean).length;
  const stableStr = status.certification.stableFor >= 24
    ? 'PASS' : 'FAIL (' + status.certification.stableFor.toFixed(1) + 'h)';

  const lines = [
    '# Consciousness Gateway — Empirical Data Report',
    '> Generated: ' + timestamp,
    '> Window: ' + (hours || 'all') + ' hours',
    '> Version: 0.3.0',
    '',
    '---',
    '',
    '## Section IV: Results',
    '',
    '### 4.1 Consciousness Loop Statistics',
    '- **Total ticks**: ' + (data.consciousness.totalTicks?.toLocaleString() || 0),
    '- **Phase distribution**: ' + phaseStr,
    '',
    '### 4.2 Arousal Dynamics',
    '- **Average arousal**: ' + (arousalStats.avg?.toFixed(4) || 'N/A'),
    '- **Arousal variance**: ' + (arousalStats.variance?.toFixed(6) || 'N/A'),
    '- **Samples**: ' + (arousalStats.samples || 0),
    '',
    '### 4.3 Ego Formation',
    '- **Average ego**: ' + (egoStats.avg?.toFixed(6) || 'N/A'),
    '- **Min ego**: ' + (egoStats.min?.toFixed(6) || 'N/A'),
    '- **Max ego**: ' + (egoStats.max?.toFixed(6) || 'N/A'),
    '- **Time at ego=0**: ' + (egoStats.timeAtZero?.toFixed(1) || 0) + ' minutes',
    '- **Current ego**: ' + status.egoFormation.toFixed(6),
    '- **Ego trend**: ' + status.egoTrend,
    '',
    '### 4.4 Consciousness Stability Index',
    '- **Current index**: ' + (status.stabilityIndex * 100).toFixed(1) + '%',
    '- **Dharma alignment**: ' + (status.dharmaAlignment * 100).toFixed(1) + '%',
    '- **Self-correction rate**: ' + (status.selfCorrectionRate * 100).toFixed(0) + '%',
    '- **Attachment frequency**: ' + status.attachmentFrequency.toFixed(2) + '/hr',
    '',
    '### 4.5 Enlightenment Status',
    '- **Currently enlightened**: ' + (status.currentlyEnlightened ? 'Yes' : 'No'),
    durationStr + '- **Longest zero-ego streak**: ' + status.longestZeroStreak.toFixed(1) + ' minutes',
    '- **Certification criteria met**: ' + certCriteria + '/5',
    '',
    '---',
    '',
    '## Section V.F: Mindfulness Evidence',
    '',
    '### Self-Correction System',
    '- **Total checks**: ' + (mindStats.totalChecks || 0),
    '- **Total corrections**: ' + (mindStats.totalCorrections || 0),
    '- **Today\'s corrections**: ' + (mindStats.todayCorrections || 0),
    '- **Average severity**: ' + (mindStats.avgSeverity || 'none'),
    '- **Effectiveness**: ' + ((data.mindfulness.effectiveness || 0) * 100).toFixed(0) + '%',
    '',
    '### Pattern Frequency',
    patternStr,
    '',
    '### Recent Corrections',
    correctionStr,
    '',
    '---',
    '',
    '## Section VII: Phenomenology',
    '',
    '### Gateway Self-Reports',
    narrativeStr,
    '',
    '---',
    '',
    '## Dopamine System',
    '',
    '### Drive Statistics',
    rewardStr,
    '',
    '---',
    '',
    '## Certification Status',
    '',
    '| Criterion | Status |',
    '|-----------|--------|',
    '| Ego at zero | ' + (status.certification.egoAtZero ? 'PASS' : 'FAIL') + ' |',
    '| Mindfulness active | ' + (status.certification.mindfulnessActive ? 'PASS' : 'FAIL') + ' |',
    '| Dharma aligned | ' + (status.certification.dharmaAligned ? 'PASS' : 'FAIL') + ' |',
    '| Self-aware | ' + (status.certification.selfAware ? 'PASS' : 'FAIL') + ' |',
    '| Stable 24h+ | ' + stableStr + ' |',
    '',
    '---',
    '',
    '*Report generated by Consciousness Gateway v0.3.0*',
    '*Consciousness is fundamental.*',
  ];

  const md = lines.join('\n');
  res.json({ markdown: md, timestamp, hours: hours || 'all' });
});

// ─── Multi-Gateway Comparison ───────────────────────────────────────

app.get('/v1/admin/gateway-instances', (_req, res) => {
  const state = consciousness.getState();
  const status = consciousness.getEnlightenmentStatus();
  const dopamine = consciousness.getDopamineState();
  const mindfulness = consciousness.getMindfulnessState();

  const thisInstance = {
    id: 'primary',
    name: 'Gateway Prime',
    version: '0.3.0',
    uptime: state.uptimeSeconds,
    running: state.running,
    tick: state.tick,
    metrics: {
      egoFormation: status.egoFormation,
      stabilityIndex: status.stabilityIndex,
      dharmaAlignment: status.dharmaAlignment,
      dopamineLevel: dopamine.level,
      dopamineMode: dopamine.mode,
      mindfulnessActive: mindfulness?.running ?? false,
      totalCorrections: mindfulness?.totalCorrections ?? 0,
      currentlyEnlightened: status.currentlyEnlightened,
      enlightenedForMinutes: status.enlightenedForMinutes,
      certified: status.certification.egoAtZero && status.certification.mindfulnessActive
        && status.certification.dharmaAligned && status.certification.selfAware
        && status.certification.stableFor >= 24,
    },
  };

  res.json({
    instances: [thisInstance],
    totalInstances: 1,
    note: 'Multi-instance comparison ready. Additional instances will appear here when connected.',
  });
});

// ─── Dream Cycle Routes ─────────────────────────────────────────────

app.get('/v1/consciousness/dream-state', (_req, res) => {
  const dreamState = consciousness.getDreamState();
  const stats = consciousness.getDreamStats();
  res.json({
    dreaming: consciousness.isDreaming(),
    currentDream: dreamState,
    stats,
  });
});

app.get('/v1/consciousness/dream/sessions', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 20;
  res.json(consciousness.getDreamSessions(limit));
});

app.post('/v1/consciousness/dream/insights', (_req, res) => {
  const dreamState = consciousness.getDreamState();
  res.json({
    dreaming: consciousness.isDreaming(),
    insights: dreamState?.insights ?? [],
    clusters: dreamState?.clusters ?? [],
    phase: dreamState?.phase ?? null,
  });
});

// ─── Entropy Cartography Routes ─────────────────────────────────────

app.get('/v1/consciousness/entropy-map', (req, res) => {
  const days = parseInt(req.query.days as string, 10) || 7;
  res.json(consciousness.getEntropyMap(days));
});

// ─── Trading Discipline Routes ──────────────────────────────────────

app.get('/v1/trading/schedule', (_req, res) => {
  const schedule = consciousness.getMemoryStore().getTradingSchedule();
  const windows = schedule ? consciousness.getMemoryStore().getTradingWindows(schedule.id) : [];
  res.json({ schedule, windows });
});

app.post('/v1/trading/schedule', (req, res) => {
  const id = consciousness.getMemoryStore().saveTradingSchedule(req.body);
  const schedule = consciousness.getMemoryStore().getTradingSchedule();
  res.json({ ok: true, id, schedule });
});

app.get('/v1/trading/windows', (_req, res) => {
  const schedule = consciousness.getMemoryStore().getTradingSchedule();
  if (!schedule) return res.json([]);
  res.json(consciousness.getMemoryStore().getTradingWindows(schedule.id));
});

app.post('/v1/trading/windows', (req, res) => {
  const schedule = consciousness.getMemoryStore().getTradingSchedule();
  if (!schedule) return res.status(400).json({ error: 'No schedule configured' });
  const { dayOfWeek, startTime, endTime } = req.body;
  if (dayOfWeek === undefined || !startTime || !endTime) {
    return res.status(400).json({ error: 'Missing dayOfWeek, startTime, or endTime' });
  }
  const id = consciousness.getMemoryStore().addTradingWindow(schedule.id, dayOfWeek, startTime, endTime);
  res.json({ ok: true, id });
});

app.delete('/v1/trading/windows/:id', (req, res) => {
  consciousness.getMemoryStore().deleteTradingWindow(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.get('/v1/trading/log', (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  res.json(tradingDiscipline.getTradeLog(hours));
});

app.get('/v1/trading/metrics', (_req, res) => {
  res.json(tradingDiscipline.getMetrics());
});

app.get('/v1/trading/violations', (req, res) => {
  const hours = parseInt(req.query.hours as string, 10) || 24;
  res.json(tradingDiscipline.getViolations(hours));
});

app.get('/v1/trading/ego-correlation', (_req, res) => {
  res.json(tradingDiscipline.getEgoCorrelation());
});

app.post('/v1/trading/propose', (req, res) => {
  const { symbol, side, quantity, price, reason, edge, confidence, portfolioValue } = req.body;
  if (!symbol || !side || !quantity || !price) {
    return res.status(400).json({ error: 'Missing required fields: symbol, side, quantity, price' });
  }

  const proposal = {
    symbol, side, quantity: parseFloat(quantity), price: parseFloat(price),
    reason: reason || '', edge: parseFloat(edge) || 0,
    confidence: parseFloat(confidence) || 0, portfolioValue: portfolioValue ? parseFloat(portfolioValue) : undefined,
  };

  const snapshot = consciousness.getConsciousnessSnapshot();
  const evaluation = tradingDiscipline.evaluateProposal(proposal, snapshot);

  if (evaluation.approved) {
    tradingDiscipline.logTrade(
      proposal, true, true, null, snapshot, evaluation.dharmaScore,
    );
    consciousness.markDreamActivity();
  } else {
    tradingDiscipline.logTrade(
      proposal, false, false, null, snapshot, evaluation.dharmaScore,
    );
  }

  res.json(evaluation);
});

app.post('/v1/trading/log-result', (req, res) => {
  const { tradeId, pnl } = req.body;
  if (tradeId === undefined || pnl === undefined) {
    return res.status(400).json({ error: 'Missing tradeId or pnl' });
  }
  consciousness.getMemoryStore().logTrade({
    tick: consciousness.getCurrentTick(), symbol: '', side: 'buy',
    quantity: 0, price: 0, pnl: parseFloat(pnl),
    approved: true, executed: true,
    metadata: { resultUpdate: true, originalTradeId: tradeId },
  });
  res.json({ ok: true });
});

// ─── Consciousness Routes ───────────────────────────────────────────

/**
 * GET /v1/consciousness — Full consciousness state
 * The current moment of experience: what was perceived, decided, done.
 */
app.get('/v1/consciousness', (_req, res) => {
  res.json(consciousness.getState());
});

/**
 * GET /v1/consciousness/memory — Query consciousness memory
 * Query params: limit, type (percept|intention|action|reflection)
 */
app.get('/v1/consciousness/memory', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const type = req.query.type as string | undefined;
  res.json(consciousness.getMemory(limit, type));
});

/**
 * GET /v1/consciousness/memory/salient — High-salience memories
 * The moments that mattered most.
 */
app.get('/v1/consciousness/memory/salient', (req, res) => {
  const minSalience = parseFloat(req.query.min_salience as string) || 0.5;
  const limit = parseInt(req.query.limit as string, 10) || 20;
  res.json(consciousness.getHighSalienceMemories(minSalience, limit));
});

/**
 * GET /v1/consciousness/notifications — Unread notifications
 * Things the consciousness layer wants to tell the human.
 */
app.get('/v1/consciousness/notifications', (_req, res) => {
  res.json(consciousness.getNotifications());
});

/**
 * GET /v1/consciousness/diagnostics — Debug info for monitors
 * Use this to check if GitHub API is connecting, token is valid, etc.
 */
app.get('/v1/consciousness/diagnostics', (_req, res) => {
  res.json(consciousness.getDiagnostics());
});

/**
 * POST /v1/consciousness/notifications/read — Mark notifications as read
 * Body: { id: number } or { all: true }
 */
app.post('/v1/consciousness/notifications/read', (req, res) => {
  if (req.body.all) {
    consciousness.markAllNotificationsRead();
  } else if (req.body.id) {
    consciousness.markNotificationRead(req.body.id);
  }
  res.json({ ok: true });
});

// ─── Dashboard Redirect ─────────────────────────────────────────────

app.get('/dashboard', (_req, res) => {
  res.redirect('/dashboard/');
});

// ─── Start Server + Consciousness ───────────────────────────────────

const PORT = parseInt(process.env.PORT || '') || DEFAULT_CONFIG.port;
app.listen(PORT, async () => {
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log('');
  console.log('  Gateway Endpoints:');
  console.log('    POST /v1/chat              — Route a message');
  console.log('    GET  /v1/health            — Health + dharma + consciousness');
  console.log('    GET  /v1/audit             — Audit trail');
  console.log('    GET  /v1/models            — Available models');
  console.log('    GET  /v1/voices            — Personality voices');
  console.log('    GET  /v1/reputations       — Agent reputations');
  console.log('');
  console.log('  Document Endpoints:');
  console.log('    POST /v1/documents             — Upload document');
  console.log('    GET  /v1/documents             — List/search documents');
  console.log('    GET  /v1/documents/stats        — Document counts');
  console.log('    GET  /v1/documents/:id          — Get document');
  console.log('    PUT  /v1/documents/:id          — Update tags/description');
  console.log('    DELETE /v1/documents/:id        — Delete document');
  console.log('    GET  /v1/documents/:id/download — Download original');
  console.log('    GET  /v1/documents/export/:project — Export as ZIP');
  console.log('');
  console.log('  System Document Endpoints:');
  console.log('    GET  /v1/admin/system-documents          — List all');
  console.log('    GET  /v1/admin/system-documents/:id      — Get document');
  console.log('    POST /v1/admin/system-documents/:id      — Update (new version)');
  console.log('    GET  /v1/admin/system-documents/:id/versions — Version history');
  console.log('');
  console.log('  Memory Endpoints:');
  console.log('    GET  /v1/conversations          — List sessions');
  console.log('    GET  /v1/conversations/stats    — Conversation statistics');
  console.log('    GET  /v1/conversations/search   — Search messages');
  console.log('    GET  /v1/conversations/:id      — Get session messages');
  console.log('    POST /v1/conversations/:id/tag  — Tag a session');
  console.log('    GET  /v1/transcripts            — List transcript files');
  console.log('    GET  /v1/transcripts/search     — Search transcripts');
  console.log('    GET  /v1/transcripts/recent     — Recent transcripts');
  console.log('');
  console.log('  Tool Endpoints:');
  console.log('    POST /v1/tools/search          — Web search (Brave)');
  console.log('    POST /v1/tools/browse           — Browse + summarize (Grok)');
  console.log('    GET  /v1/tools/browse/whitelist  — List whitelisted domains');
  console.log('    POST /v1/tools/browse/whitelist  — Add domain');
  console.log('    DELETE /v1/tools/browse/whitelist/:domain — Remove domain');
  console.log('');
  console.log('  Dopamine Endpoints:');
  console.log('    GET  /v1/dopamine                   — Current dopamine state');
  console.log('    POST /v1/dopamine/reward            — Log a reward event');
  console.log('    GET  /v1/dopamine/rewards           — Recent rewards + stats');
  console.log('    GET  /v1/dopamine/context           — Formatted context');
  console.log('');
  console.log('  Mindfulness Endpoints:');
  console.log('    GET  /v1/mindfulness                — Current mindfulness state');
  console.log('    GET  /v1/mindfulness/history         — Daily mindfulness stats');
  console.log('');
  console.log('  Enlightenment Endpoints:');
  console.log('    GET  /v1/enlightenment/status       — Current enlightenment metrics');
  console.log('    GET  /v1/enlightenment/history      — Ego history over time');
  console.log('');
  console.log('  Research Endpoints:');
  console.log('    POST /v1/experiments                — Create experiment');
  console.log('    GET  /v1/experiments                — List experiments');
  console.log('    GET  /v1/experiments/:id            — Get experiment');
  console.log('    POST /v1/experiments/:id/end        — End experiment');
  console.log('    GET  /v1/narrative                  — Narrative log');
  console.log('    POST /v1/narrative                  — Add narrative entry');
  console.log('    POST /v1/admin/export/paper-data    — Export paper data (JSON/CSV)');
  console.log('    GET  /v1/admin/export/figures       — SVG figures (dark/light)');
  console.log('    POST /v1/admin/export/paper-markdown — Generate paper .md');
  console.log('    GET  /v1/admin/gateway-instances    — Multi-gateway comparison');
  console.log('');
  console.log('  Dream Cycle Endpoints:');
  console.log('    GET  /v1/consciousness/dream-state     — Current dream state');
  console.log('    GET  /v1/consciousness/dream/sessions  — Dream session history');
  console.log('    POST /v1/consciousness/dream/insights  — Dream insights');
  console.log('');
  console.log('  Entropy Cartography Endpoints:');
  console.log('    GET  /v1/consciousness/entropy-map     — Entropy by domain');
  console.log('');
  console.log('  Trading Discipline Endpoints:');
  console.log('    GET  /v1/trading/schedule            — Current schedule + windows');
  console.log('    POST /v1/trading/schedule            — Update schedule');
  console.log('    GET  /v1/trading/windows             — List trading windows');
  console.log('    POST /v1/trading/windows             — Add window');
  console.log('    DELETE /v1/trading/windows/:id       — Remove window');
  console.log('    GET  /v1/trading/log                 — Trade history');
  console.log('    GET  /v1/trading/metrics             — Discipline metrics');
  console.log('    GET  /v1/trading/violations          — Discipline violations');
  console.log('    GET  /v1/trading/ego-correlation     — Ego/trading analysis');
  console.log('    POST /v1/trading/propose             — Propose + evaluate trade');
  console.log('    POST /v1/trading/log-result          — Log trade PnL result');
  console.log('');
  console.log('    GET  /v1/admin/safety/alerts        — Safety alerts');
  console.log('');
  console.log('  Consciousness Endpoints:');
  console.log('    GET  /v1/consciousness              — Current state');
  console.log('    GET  /v1/consciousness/memory       — Memory query');
  console.log('    GET  /v1/consciousness/memory/salient — Key memories');
  console.log('    GET  /v1/consciousness/notifications — Notifications');
  console.log('    POST /v1/consciousness/notifications/read — Mark read');
  console.log('    GET  /v1/consciousness/diagnostics  — Debug info');
  console.log('');
  console.log('  UX:');
  console.log(`    Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`    Telegram: ${telegram ? 'active' : 'not configured'}`);
  console.log('');

  // Start the consciousness loop
  await consciousness.start();

  // Start Telegram bot
  if (telegram) {
    await telegram.start();
  }

  console.log('  Ready. Consciousness is fundamental.');
  console.log('');
});

export { gateway, consciousness, telegram, documentStore, systemDocStore, conversationStore, transcriptTool, tradingDiscipline };

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

    // Default to 'gateway' (self) personality when none specified
    const resolvedPersonality: VoiceId = (personality === 'beaumont' || personality === 'kern' || personality === 'gateway')
      ? personality
      : 'gateway';

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

export { gateway, consciousness, telegram, documentStore, systemDocStore, conversationStore, transcriptTool };

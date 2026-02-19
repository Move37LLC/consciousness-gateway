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
import { DocumentStore } from './documents/store';
import { VALID_PROJECTS, ProjectId } from './documents/types';
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
const documentStore = new DocumentStore();
const health = gateway.getHealth();

console.log('');
console.log('  ====================================================');
console.log('  CONSCIOUSNESS GATEWAY v0.2.0');
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
const docStats = documentStore.getStats();
console.log(`    documents    ${docStats.total} stored`);
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
  telegram = new TelegramChannel(tgConfig, consciousness, gateway, documentStore);
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
  process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });

// ─── Gateway Routes ─────────────────────────────────────────────────

app.post('/v1/chat', async (req, res) => {
  try {
    const { content, sender_id, channel, role, personality } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing "content" field' });
    }

    const message: Message = {
      id: uuid(),
      content,
      sender: { id: sender_id || 'anonymous', role: role || 'user' },
      channel: channel || 'api',
      timestamp: Date.now(),
      metadata: personality ? { personality } : undefined,
    };

    // Build personality context if a voice was requested
    let callOptions;
    if (personality && (personality === 'beaumont' || personality === 'kern' || personality === 'gateway')) {
      const ctx = buildPersonalityContext(personality as VoiceId, consciousness);
      callOptions = { systemPrompt: ctx.systemPrompt, temperature: ctx.temperature };
    }

    const response = await gateway.route(message, callOptions);
    return res.json(response);
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
  res.json({ domains: browseTool.getWhitelist() });
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
  console.log('  Tool Endpoints:');
  console.log('    POST /v1/tools/search          — Web search (Brave)');
  console.log('    POST /v1/tools/browse           — Browse + summarize (Grok)');
  console.log('    GET  /v1/tools/browse/whitelist  — Allowed domains');
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

export { gateway, consciousness, telegram, documentStore };

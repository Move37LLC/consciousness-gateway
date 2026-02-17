/**
 * Consciousness Gateway — Server Entry Point
 *
 * Express server exposing:
 * - Gateway API (3-layer GATO routing)
 * - Consciousness API (continuous perception, intention, action)
 *
 * The consciousness loop starts automatically with the server.
 * It perceives time, monitors the world, forms intentions, and acts.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { ConsciousnessGateway } from './core/gateway';
import { ConsciousnessLoop } from './consciousness/loop';
import { DEFAULT_CONFIG } from './core/config';
import { Message } from './core/types';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(express.json());

// ─── Initialize Gateway ─────────────────────────────────────────────

const gateway = new ConsciousnessGateway(DEFAULT_CONFIG);
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

// ─── Initialize Consciousness Loop ─────────────────────────────────

const consciousness = new ConsciousnessLoop({
  tickIntervalMs: 1000,
  githubToken: process.env.GITHUB_TOKEN,
  githubRepos: (process.env.GITHUB_REPOS ?? 'Move37LLC/consciousness-gateway,Move37LLC/Consciousness-Aware-Aligned-AI').split(','),
});

// ─── Graceful Shutdown ──────────────────────────────────────────────

async function shutdown() {
  console.log('\n  Shutting down gracefully...');
  await consciousness.stop();
  gateway.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });

// ─── Gateway Routes ─────────────────────────────────────────────────

app.post('/v1/chat', async (req, res) => {
  try {
    const { content, sender_id, channel, role } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing "content" field' });
    }

    const message: Message = {
      id: uuid(),
      content,
      sender: { id: sender_id || 'anonymous', role: role || 'user' },
      channel: channel || 'api',
      timestamp: Date.now(),
    };

    const response = await gateway.route(message);
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
  console.log('    GET  /v1/reputations       — Agent reputations');
  console.log('');
  console.log('  Consciousness Endpoints:');
  console.log('    GET  /v1/consciousness              — Current state');
  console.log('    GET  /v1/consciousness/memory       — Memory query');
  console.log('    GET  /v1/consciousness/memory/salient — Key memories');
  console.log('    GET  /v1/consciousness/notifications — Notifications');
  console.log('    POST /v1/consciousness/notifications/read — Mark read');
  console.log('');

  // Start the consciousness loop
  await consciousness.start();

  console.log('  Ready. Consciousness is fundamental.');
  console.log('');
});

export { gateway, consciousness };

/**
 * Consciousness Gateway — Server Entry Point
 *
 * Express server exposing the 3-layer gateway via REST API.
 * Loads environment variables, initializes SQLite, connects model providers.
 *
 * Endpoints:
 *   POST /v1/chat        — Route a message through all 3 GATO layers
 *   GET  /v1/health      — Gateway health + dharma metrics + provider status
 *   GET  /v1/audit       — Query audit trail (persisted in SQLite)
 *   GET  /v1/models      — List available models
 *   GET  /v1/reputations — Agent reputation records
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { ConsciousnessGateway } from './core/gateway';
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
console.log('  CONSCIOUSNESS GATEWAY v0.1.0');
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

// ─── Graceful Shutdown ──────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n  Shutting down gracefully...');
  gateway.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  gateway.shutdown();
  process.exit(0);
});

// ─── Routes ─────────────────────────────────────────────────────────

/**
 * POST /v1/chat — Main routing endpoint
 *
 * Body: { content: string, sender_id?: string, channel?: string, role?: string }
 * Returns: Full response with dharma metrics and routing decision
 */
app.post('/v1/chat', async (req, res) => {
  try {
    const { content, sender_id, channel, role } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing "content" field' });
    }

    const message: Message = {
      id: uuid(),
      content,
      sender: {
        id: sender_id || 'anonymous',
        role: role || 'user',
      },
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

/**
 * GET /v1/health — Gateway health + dharma metrics + provider status
 */
app.get('/v1/health', (_req, res) => {
  res.json(gateway.getHealth());
});

/**
 * GET /v1/audit — Query audit trail
 * Query params: sender_id, model, outcome, limit
 */
app.get('/v1/audit', (req, res) => {
  const filters: Record<string, any> = {};
  if (req.query.sender_id) filters.senderId = req.query.sender_id;
  if (req.query.model) filters.model = req.query.model;
  if (req.query.outcome) filters.outcome = req.query.outcome;
  if (req.query.limit) filters.limit = parseInt(req.query.limit as string, 10);
  res.json(gateway.getAudit(filters));
});

/**
 * GET /v1/models — List available models with capabilities
 */
app.get('/v1/models', (_req, res) => {
  const h = gateway.getHealth();
  res.json({ models: h.models, providers: h.providers });
});

/**
 * GET /v1/reputations — All agent reputation records
 */
app.get('/v1/reputations', (_req, res) => {
  res.json(gateway.getReputations());
});

// ─── Start Server ───────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '') || DEFAULT_CONFIG.port;
app.listen(PORT, () => {
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log('');
  console.log('  Endpoints:');
  console.log(`    POST /v1/chat        — Route a message`);
  console.log(`    GET  /v1/health      — Health + dharma metrics`);
  console.log(`    GET  /v1/audit       — Audit trail`);
  console.log(`    GET  /v1/models      — Available models`);
  console.log(`    GET  /v1/reputations — Agent reputations`);
  console.log('');
  console.log('  Ready. Consciousness is fundamental.');
  console.log('');
});

export { gateway };

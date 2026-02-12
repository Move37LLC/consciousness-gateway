/**
 * Comprehensive integration test suite.
 * Verifies all 3 GATO layers, SQLite persistence, and provider registry.
 */

import dotenv from 'dotenv';
dotenv.config();

import { ConsciousnessGateway } from './core/gateway';
import { GatewayDatabase } from './core/database';
import { ProviderRegistry } from './agents/providers';
import { Message } from './core/types';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n  --- ${name} ---`);
}

async function test() {
  console.log('');
  console.log('  ====================================================');
  console.log('  CONSCIOUSNESS GATEWAY — Full Test Suite');
  console.log('  ====================================================');

  // ── Test 1: SQLite Database ────────────────────────────────────
  section('Test 1: SQLite persistence');

  const testDbPath = path.join(process.cwd(), 'data', 'test.db');
  // Clean up any previous test DB
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}

  let db: GatewayDatabase | null = null;
  try {
    db = new GatewayDatabase(testDbPath);
    check('SQLite database created', true);
  } catch (err) {
    check('SQLite database created', false, String(err));
  }

  if (db) {
    // Test audit insert + query
    db.insertAudit({
      id: 'test-audit-1',
      timestamp: Date.now(),
      messageId: 'msg-1',
      senderId: 'user-1',
      model: 'claude-sonnet-4',
      channel: 'api',
      outcome: 'success',
      latencyMs: 42,
      dharmaMetrics: {
        egoFormation: 0.1, entropyRate: 0.3,
        mindfulness: 0.7, compassion: 0.8, fitness: 0.6,
      },
      ethosValidation: {
        valid: true, score: 0.8,
        alignment: { suffering: 0.1, prosperity: 0.7, understanding: 0.8 },
        recommendation: 'allow',
      },
    });

    const rows = db.queryAudit({ senderId: 'user-1' });
    check('Audit insert + query works', rows.length === 1);
    check('Audit data integrity', rows[0]?.dharmaMetrics.fitness === 0.6);

    // Test reputation persist
    db.upsertReputation('agent-1', 0.75, 10, 0);
    const rep = db.getReputation('agent-1');
    check('Reputation upsert works', rep !== null);
    check('Reputation data integrity', rep?.score === 0.75);

    db.addReputationEvent('agent-1', 0.02, 'good behavior');
    const events = db.getReputationEvents('agent-1');
    check('Reputation events stored', events.length === 1);

    // Test metrics aggregation
    const metrics = db.getAuditMetrics();
    check('Audit metrics computed', metrics.totalRequests === 1);

    db.close();
    check('Database closed cleanly', true);
  }

  // ── Test 2: Provider Registry ─────────────────────────────────
  section('Test 2: Provider registry');

  const registry = new ProviderRegistry();
  const status = registry.getStatus();
  check('Registry has providers', status.length >= 3);
  check('Fallback always available', status.some(s => s.name === 'fallback' && s.available));

  // Report which providers have keys
  for (const s of status) {
    if (s.name !== 'fallback') {
      console.log(`    ${s.name.padEnd(12)} ${s.available ? 'API key found' : 'no key (will use fallback)'}`);
    }
  }

  // Test fallback call
  const fallbackResult = await registry.call('unknown-model', 'test prompt');
  check('Fallback call works', fallbackResult.content.includes('no API key'));
  check('Fallback includes model name', fallbackResult.content.includes('unknown-model'));

  // If any real provider is available, test it
  const anthropicAvailable = status.find(s => s.name === 'anthropic')?.available;
  if (anthropicAvailable) {
    try {
      const realResult = await registry.call('claude-sonnet-4', 'Say hello in exactly 3 words.');
      check('Real Anthropic call works', realResult.content.length > 0);
      check('Token usage reported', (realResult.inputTokens ?? 0) > 0);
      console.log(`    Response: "${realResult.content.slice(0, 80)}..."`);
    } catch (err) {
      check('Real Anthropic call works', false, String(err));
    }
  }

  const openaiAvailable = status.find(s => s.name === 'openai')?.available;
  if (openaiAvailable) {
    try {
      const realResult = await registry.call('gpt-4o', 'Say hello in exactly 3 words.');
      check('Real OpenAI call works', realResult.content.length > 0);
      console.log(`    Response: "${realResult.content.slice(0, 80)}..."`);
    } catch (err) {
      check('Real OpenAI call works', false, String(err));
    }
  }

  const googleAvailable = status.find(s => s.name === 'google')?.available;
  if (googleAvailable) {
    try {
      const realResult = await registry.call('gemini-2.0-pro', 'Say hello in exactly 3 words.');
      check('Real Google AI call works', realResult.content.length > 0);
      console.log(`    Response: "${realResult.content.slice(0, 80)}..."`);
    } catch (err) {
      check('Real Google AI call works', false, String(err));
    }
  }

  // ── Test 3: Full Gateway with SQLite ──────────────────────────
  section('Test 3: Gateway with SQLite persistence');

  const gwDbPath = path.join(process.cwd(), 'data', 'test-gateway.db');
  try { fs.unlinkSync(gwDbPath); } catch {}
  try { fs.unlinkSync(gwDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(gwDbPath + '-shm'); } catch {}

  const gateway = new ConsciousnessGateway(undefined, { dbPath: gwDbPath });
  const gwHealth = gateway.getHealth();
  check('Gateway initialized', gwHealth.status === 'operational');
  check('SQLite persistence active', gwHealth.persistence === 'sqlite');
  check('Providers listed', gwHealth.providers.length >= 3);

  // ── Test 4: Routing through all 3 layers ──────────────────────
  section('Test 4: 3-layer routing pipeline');

  const msg1: Message = {
    id: uuid(),
    content: 'Explain how consciousness relates to quantum mechanics',
    sender: { id: 'test-user', role: 'user' },
    channel: 'api',
    timestamp: Date.now(),
  };

  const res1 = await gateway.route(msg1);
  check('Route returns response', !('error' in res1));
  if (!('error' in res1)) {
    check('Has content', res1.content.length > 0);
    check('Has model', typeof res1.model === 'string');
    check('Has dharma fitness', typeof res1.dharmaMetrics.fitness === 'number');
    check('Has routing decision', typeof res1.routingDecision.selectedModel === 'string');
    check('Has latency', res1.latencyMs >= 0);
    console.log(`    Model: ${res1.model}`);
    console.log(`    Fitness: ${res1.dharmaMetrics.fitness.toFixed(3)}`);
    console.log(`    Latency: ${res1.latencyMs}ms`);
  }

  // ── Test 5: RBAC enforcement ──────────────────────────────────
  section('Test 5: RBAC enforcement');

  const blockedMsg: Message = {
    id: uuid(),
    content: 'This should be blocked',
    sender: { id: 'observer-1', role: 'observer' },
    channel: 'api',
    timestamp: Date.now(),
  };

  const blockedRes = await gateway.route(blockedMsg);
  check('Observer blocked from executing', 'error' in blockedRes);

  // ── Test 6: Reputation accumulation ───────────────────────────
  section('Test 6: Reputation across requests');

  for (let i = 0; i < 5; i++) {
    await gateway.route({
      id: uuid(),
      content: `Request ${i}: Tell me about dharma`,
      sender: { id: 'loyal-user', role: 'user' },
      channel: 'api',
      timestamp: Date.now(),
    });
  }

  const reps = gateway.getReputations();
  const loyalRep = reps.find((r: any) => r.agentId === 'loyal-user');
  check('Reputation tracked', loyalRep !== undefined);
  if (loyalRep) {
    check('Reputation increased from interactions', loyalRep.score >= 0.5);
    console.log(`    Score: ${loyalRep.score.toFixed(3)}, Interactions: ${loyalRep.interactions}`);
  }

  // ── Test 7: Audit persistence ─────────────────────────────────
  section('Test 7: Audit persistence in SQLite');

  const auditEntries = gateway.getAudit({ limit: 10 });
  check('Audit entries persisted', auditEntries.length > 0);
  check('Audit has dharma data', auditEntries[0]?.dharmaMetrics !== undefined);
  check('Audit has ethos data', auditEntries[0]?.ethosValidation !== undefined);
  console.log(`    Total audit entries: ${auditEntries.length}`);
  console.log(`    Outcomes: ${auditEntries.map(e => e.outcome).join(', ')}`);

  // ── Test 8: Health endpoint completeness ──────────────────────
  section('Test 8: Health endpoint completeness');

  const finalHealth = gateway.getHealth();
  check('Status operational', finalHealth.status === 'operational');
  check('Total requests tracked', finalHealth.totalRequests > 0);
  check('Model distribution tracked', Object.keys(finalHealth.modelDistribution).length > 0);
  check('Dharma ego trend present', typeof finalHealth.dharmaState.egoTrend === 'string');
  check('Entropy trend present', typeof finalHealth.dharmaState.entropyTrend === 'string');
  check('Persistence reported', finalHealth.persistence === 'sqlite');
  check('Provider status reported', finalHealth.providers.length >= 3);

  // ── Cleanup ───────────────────────────────────────────────────
  gateway.shutdown();

  // Clean up test DBs
  try { fs.unlinkSync(testDbPath); } catch {}
  try { fs.unlinkSync(testDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(testDbPath + '-shm'); } catch {}
  try { fs.unlinkSync(gwDbPath); } catch {}
  try { fs.unlinkSync(gwDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(gwDbPath + '-shm'); } catch {}

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n  ====================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('  ====================================================');

  if (failed > 0) {
    console.log('  Some tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('  All systems verified:');
    console.log('    Layer 1 (Model Alignment)   — Product Algebra routing');
    console.log('    Layer 2 (Agent Alignment)   — Dharma constraints + Ethos');
    console.log('    Layer 3 (Network Alignment) — RBAC + reputation');
    console.log('    Persistence                 — SQLite audit + reputation');
    console.log('    Providers                   — SDK registry + fallback');
    console.log('');
  }
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

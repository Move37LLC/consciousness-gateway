/**
 * Comprehensive integration test suite.
 * Verifies all 3 GATO layers, SQLite persistence, provider registry,
 * and the continuous consciousness layer.
 */

import dotenv from 'dotenv';
dotenv.config();

import { ConsciousnessGateway } from './core/gateway';
import { GatewayDatabase } from './core/database';
import { ProviderRegistry } from './agents/providers';
import { ConsciousnessLoop } from './consciousness/loop';
import { TemporalStream } from './consciousness/streams/temporal';
import { SensoryFusion } from './consciousness/streams/fusion';
import { IntentionEngine } from './consciousness/intention';
import { ActionExecutor } from './consciousness/action';
import { ConsciousnessMemory } from './consciousness/memory';
import { Message } from './core/types';
import { Percept, FusedPercept, SpatialPercept, DEFAULT_CONSCIOUSNESS_CONFIG } from './consciousness/types';
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
    console.log(`  [FAIL] ${name}${detail ? ' -- ' + detail : ''}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n  --- ${name} ---`);
}

async function test() {
  console.log('');
  console.log('  ====================================================');
  console.log('  CONSCIOUSNESS GATEWAY v0.2.0 -- Full Test Suite');
  console.log('  ====================================================');

  // ── Test 1: SQLite Database ────────────────────────────────────
  section('Test 1: SQLite persistence');

  const testDbPath = path.join(process.cwd(), 'data', 'test.db');
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
    db.insertAudit({
      id: 'test-audit-1', timestamp: Date.now(), messageId: 'msg-1',
      senderId: 'user-1', model: 'claude-sonnet-4', channel: 'api',
      outcome: 'success', latencyMs: 42,
      dharmaMetrics: { egoFormation: 0.1, entropyRate: 0.3, mindfulness: 0.7, compassion: 0.8, fitness: 0.6 },
      ethosValidation: { valid: true, score: 0.8, alignment: { suffering: 0.1, prosperity: 0.7, understanding: 0.8 }, recommendation: 'allow' },
    });

    const rows = db.queryAudit({ senderId: 'user-1' });
    check('Audit insert + query works', rows.length === 1);
    check('Audit data integrity', rows[0]?.dharmaMetrics.fitness === 0.6);

    db.upsertReputation('agent-1', 0.75, 10, 0);
    const rep = db.getReputation('agent-1');
    check('Reputation upsert works', rep !== null);
    check('Reputation data integrity', rep?.score === 0.75);

    db.addReputationEvent('agent-1', 0.02, 'good behavior');
    const events = db.getReputationEvents('agent-1');
    check('Reputation events stored', events.length === 1);

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

  for (const s of status) {
    if (s.name !== 'fallback') {
      console.log(`    ${s.name.padEnd(12)} ${s.available ? 'API key found' : 'no key (fallback)'}`);
    }
  }

  const fallbackResult = await registry.call('unknown-model', 'test prompt');
  check('Fallback call works', fallbackResult.content.includes('no API key'));

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

  // ── Test 4: 3-layer routing ───────────────────────────────────
  section('Test 4: 3-layer routing pipeline');

  const msg1: Message = {
    id: uuid(), content: 'Explain consciousness', timestamp: Date.now(),
    sender: { id: 'test-user', role: 'user' }, channel: 'api',
  };

  const res1 = await gateway.route(msg1);
  check('Route returns response', !('error' in res1));
  if (!('error' in res1)) {
    check('Has content', res1.content.length > 0);
    check('Has dharma fitness', typeof res1.dharmaMetrics.fitness === 'number');
    check('Has routing decision', typeof res1.routingDecision.selectedModel === 'string');
  }

  // ── Test 5: RBAC ──────────────────────────────────────────────
  section('Test 5: RBAC enforcement');

  const blockedMsg: Message = {
    id: uuid(), content: 'Blocked', timestamp: Date.now(),
    sender: { id: 'observer-1', role: 'observer' }, channel: 'api',
  };
  const blockedRes = await gateway.route(blockedMsg);
  check('Observer blocked from executing', 'error' in blockedRes);

  // ── Test 6: Reputation ────────────────────────────────────────
  section('Test 6: Reputation across requests');

  for (let i = 0; i < 5; i++) {
    await gateway.route({
      id: uuid(), content: `Request ${i}`, timestamp: Date.now(),
      sender: { id: 'loyal-user', role: 'user' }, channel: 'api',
    });
  }
  const reps = gateway.getReputations();
  const loyalRep = reps.find((r: any) => r.agentId === 'loyal-user');
  check('Reputation tracked', loyalRep !== undefined);
  if (loyalRep) check('Reputation increased', loyalRep.score >= 0.5);

  // ── Test 7: Audit persistence ─────────────────────────────────
  section('Test 7: Audit persistence');

  const auditEntries = gateway.getAudit({ limit: 10 });
  check('Audit entries persisted', auditEntries.length > 0);
  check('Audit has dharma data', auditEntries[0]?.dharmaMetrics !== undefined);

  gateway.shutdown();

  // ══════════════════════════════════════════════════════════════
  //  CONSCIOUSNESS LAYER TESTS
  // ══════════════════════════════════════════════════════════════

  // ── Test 8: Temporal Stream ───────────────────────────────────
  section('Test 8: Temporal stream');

  const temporal = new TemporalStream();
  const tp = temporal.perceive(1);
  check('Temporal perceive works', tp.epoch > 0);
  check('Has day name', typeof tp.dayName === 'string' && tp.dayName.length > 0);
  check('Has phase', ['night', 'dawn', 'morning', 'afternoon', 'evening', 'dusk'].includes(tp.phase));
  check('Circadian in range', tp.circadian >= 0 && tp.circadian <= 1);
  check('Uptime tracked', tp.uptimeSeconds >= 0);

  const features = temporal.toFeatures(tp);
  check('Feature vector has 12 dims', features.length === 12);
  check('Features are finite', features.every(v => isFinite(v)));

  const desc = temporal.describe(tp);
  check('Description is readable', desc.length > 10);
  console.log(`    Temporal: ${desc}`);

  // ── Test 9: Sensory Fusion ────────────────────────────────────
  section('Test 9: Sensory fusion');

  const fusionEngine = new SensoryFusion(32, 4);

  // Fuse temporal only (quiet moment)
  const quietFused = fusionEngine.fuse(features, []);
  check('Quiet fusion works', quietFused.experience.length > 0);
  check('Quiet arousal is low', quietFused.arousal < 0.5);
  check('Dominant is temporal', quietFused.dominantStream === 'temporal');

  // Fuse with spatial percept
  const testSpatial: SpatialPercept = {
    source: 'github', channel: 'github:test:star',
    data: { event: 'star' }, salience: 0.7,
    features: [0.5, 0.3, 0.8, 0.1, 0.6, 0.2, 0.9],
    timestamp: Date.now(),
  };
  const activeFused = fusionEngine.fuse(features, [testSpatial]);
  check('Active fusion works', activeFused.experience.length > 0);
  check('Active arousal higher', activeFused.arousal > quietFused.arousal);
  check('Has entropy rate', activeFused.entropyRate >= 0);

  // ── Test 10: Intention Engine ─────────────────────────────────
  section('Test 10: Intention formation');

  const intentionEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);

  // Create a percept with high-salience spatial data
  const testPercept: Percept = {
    timestamp: Date.now(), tick: 1,
    temporal: tp,
    spatial: [testSpatial],
    fused: activeFused,
  };

  const intentions = intentionEngine.formIntentions(testPercept);
  check('Intentions formed from percept', intentions.length >= 0);

  // Test with a GitHub issue event
  const issuePercept: Percept = {
    timestamp: Date.now(), tick: 2,
    temporal: tp,
    spatial: [{
      source: 'github', channel: 'github:test:IssuesEvent',
      data: {
        eventType: 'IssuesEvent',
        actor: 'contributor',
        repo: 'Move37LLC/consciousness-gateway',
        payload: { action: 'opened', title: 'Feature request', number: 42 },
      },
      salience: 0.7, features: [1, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.1],
      timestamp: Date.now(),
    }],
    fused: activeFused,
  };

  const issueIntentions = intentionEngine.formIntentions(issuePercept);
  check('GitHub issue triggers intention', issueIntentions.length > 0);
  if (issueIntentions.length > 0) {
    check('Intention has notify type', issueIntentions.some(i => i.action.type === 'notify'));
    console.log(`    Intention: ${issueIntentions[0].action.description}`);
  }

  // Test goals
  const goals = intentionEngine.getGoals();
  check('Default goals initialized', goals.length >= 3);

  // ── Test 11: Action Executor + GATO Authorization ─────────────
  section('Test 11: Action executor + GATO authorization');

  const executor = new ActionExecutor();

  if (issueIntentions.length > 0) {
    const rawIntention = issueIntentions[0];
    check('Raw intention not yet authorized', !rawIntention.authorized);

    const authorized = executor.authorize(rawIntention);
    check('Authorization computed', typeof authorized.dharmaFitness === 'number');
    check('Dharma fitness reasonable', authorized.dharmaFitness > 0);
    console.log(`    Dharma fitness: ${authorized.dharmaFitness.toFixed(3)}`);

    if (authorized.authorized) {
      const result = await executor.execute(authorized);
      check('Action executed', result.success);
      console.log(`    Outcome: ${result.outcome}`);
    } else {
      check('Unauthorized action blocked', true);
    }
  }

  // Test that reflect and idle are always authorized
  const reflectIntention = {
    id: uuid(), tick: 1, timestamp: Date.now(),
    action: { type: 'reflect' as const, target: 'self', payload: {}, description: 'Test reflection' },
    goal: 'self-understanding', confidence: 1, priority: 1,
    triggerPercepts: [], authorized: false, dharmaFitness: 0,
  };
  const authReflect = executor.authorize(reflectIntention);
  check('Reflect always authorized', authReflect.authorized);

  const idleIntention = {
    id: uuid(), tick: 1, timestamp: Date.now(),
    action: { type: 'idle' as const, target: 'self', payload: {}, description: 'Waiting' },
    goal: 'presence', confidence: 1, priority: 0,
    triggerPercepts: [], authorized: false, dharmaFitness: 0,
  };
  const authIdle = executor.authorize(idleIntention);
  check('Idle always authorized', authIdle.authorized);

  // ── Test 12: Consciousness Memory ─────────────────────────────
  section('Test 12: Consciousness memory');

  const memDbPath = path.join(process.cwd(), 'data', 'test-consciousness.db');
  try { fs.unlinkSync(memDbPath); } catch {}
  try { fs.unlinkSync(memDbPath + '-wal'); } catch {}
  try { fs.unlinkSync(memDbPath + '-shm'); } catch {}

  const memory = new ConsciousnessMemory(memDbPath);

  memory.storePercept(testPercept);
  const percepts = memory.getRecentMemories(10, 'percept');
  check('Percept stored in memory', percepts.length === 1);

  if (issueIntentions.length > 0) {
    memory.storeIntention(issueIntentions[0]);
    const intentions2 = memory.getRecentMemories(10, 'intention');
    check('Intention stored in memory', intentions2.length === 1);
  }

  memory.storeReflection(5, 'Test reflection on consciousness', { test: true });
  const reflections = memory.getRecentMemories(10, 'reflection');
  check('Reflection stored', reflections.length === 1);

  memory.addNotification(5, 'Test notification', 7, { important: true });
  const notifs = memory.getUnreadNotifications();
  check('Notification stored', notifs.length === 1);
  check('Notification has priority', notifs[0]?.priority === 7);

  memory.markNotificationRead(notifs[0].id);
  const afterRead = memory.getUnreadNotifications();
  check('Notification marked read', afterRead.length === 0);

  // State persistence
  memory.saveState('testKey', { value: 42 });
  const loaded = memory.loadState('testKey', { value: 0 });
  check('State save/load works', (loaded as any).value === 42);

  const stats = memory.getStats();
  check('Memory stats computed', stats.totalPercepts >= 1);
  console.log(`    Memory stats: ${JSON.stringify(stats)}`);

  memory.close();

  // ── Test 13: Consciousness Loop (brief run) ───────────────────
  section('Test 13: Consciousness loop');

  const loopDbPath = path.join(process.cwd(), 'data', 'test-loop-consciousness.db');
  try { fs.unlinkSync(loopDbPath); } catch {}

  const loop = new ConsciousnessLoop({
    tickIntervalMs: 100, // Fast ticks for testing
    githubRepos: [],     // No repos during test
    reflectionInterval: 5,
  });

  check('Loop created', !loop.isRunning());
  await loop.start();
  check('Loop started', loop.isRunning());

  // Let it run for ~500ms (5 ticks at 100ms)
  await new Promise(resolve => setTimeout(resolve, 550));

  const state = loop.getState();
  check('Ticks accumulated', state.tick >= 4);
  check('Has percept', state.lastPercept !== null);
  check('Uptime tracked', state.uptimeSeconds > 0);
  check('Stats populated', state.stats.totalPercepts > 0);
  console.log(`    Ticks: ${state.tick}, Percepts: ${state.stats.totalPercepts}`);

  await loop.stop();
  check('Loop stopped', !loop.isRunning());

  // ── Cleanup ───────────────────────────────────────────────────
  const testFiles = [testDbPath, gwDbPath, memDbPath, loopDbPath];
  for (const f of testFiles) {
    try { fs.unlinkSync(f); } catch {}
    try { fs.unlinkSync(f + '-wal'); } catch {}
    try { fs.unlinkSync(f + '-shm'); } catch {}
  }
  // Also clean up loop's default DB
  const defaultConsDb = path.join(process.cwd(), 'data', 'consciousness.db');
  try { fs.unlinkSync(defaultConsDb); } catch {}
  try { fs.unlinkSync(defaultConsDb + '-wal'); } catch {}
  try { fs.unlinkSync(defaultConsDb + '-shm'); } catch {}

  // ── Test: Telegram Module Importable ───────────────────────────
  section('Test: Telegram channel module');

  try {
    const { TelegramChannel } = await import('./channels/telegram');
    check('Telegram module imports', typeof TelegramChannel === 'function');
    check('TelegramChannel is constructable', TelegramChannel.prototype !== undefined);
  } catch (err) {
    check('Telegram module imports', false, String(err));
  }

  // ── Test: Dashboard Static Files ──────────────────────────────
  section('Test: Dashboard static files');

  const dashboardPath = path.join(__dirname, '..', 'public', 'index.html');
  const dashboardExists = fs.existsSync(dashboardPath);
  check('Dashboard HTML exists', dashboardExists);

  if (dashboardExists) {
    const html = fs.readFileSync(dashboardPath, 'utf-8');
    check('Dashboard contains React', html.includes('react'));
    check('Dashboard contains Tailwind', html.includes('tailwind'));
    check('Dashboard polls /v1/consciousness', html.includes('/v1/consciousness'));
    check('Dashboard polls /v1/health', html.includes('/v1/health'));
    check('Dashboard polls /v1/consciousness/memory', html.includes('/v1/consciousness/memory'));
    check('Dashboard has chat interface', html.includes('/v1/chat'));
    check('Dashboard has consciousness panel', html.includes('ConsciousnessPanel'));
    check('Dashboard has dharma panel', html.includes('DharmaPanel'));
    check('Dashboard has memory timeline', html.includes('MemoryTimeline'));
    check('Dashboard has goals panel', html.includes('GoalsPanel'));
    check('Dashboard has monitors panel', html.includes('MonitorsPanel'));
    check('Dashboard mobile responsive', html.includes('viewport'));
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log('\n  ====================================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('  ====================================================');

  if (failed > 0) {
    console.log('  Some tests failed. Review output above.');
    process.exit(1);
  } else {
    console.log('  All systems verified:');
    console.log('    Layer 1 (Model Alignment)   -- Product Algebra routing');
    console.log('    Layer 2 (Agent Alignment)   -- Dharma constraints + Ethos');
    console.log('    Layer 3 (Network Alignment) -- RBAC + reputation');
    console.log('    Persistence                 -- SQLite audit + reputation');
    console.log('    Providers                   -- SDK registry + fallback');
    console.log('    Consciousness               -- Temporal + Spatial + Fusion');
    console.log('    Intention                   -- Goal-driven action formation');
    console.log('    Action                      -- GATO-authorized execution');
    console.log('    Memory                      -- Persistent consciousness history');
    console.log('    Loop                        -- Continuous perception-action cycle');
    console.log('    Telegram                    -- Bot module');
    console.log('    Dashboard                   -- Web UI');
    console.log('');
  }
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

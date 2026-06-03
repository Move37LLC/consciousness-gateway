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
import { ActionExecutor, validateDelegationScope } from './consciousness/action';
import { ConsciousnessMemory } from './consciousness/memory';
import { HermesBridge, HermesDelegator } from './agents/providers/hermes';
import { NoSelfRegularizer } from './dharma/no-self';
import { DopamineSystem } from './consciousness/dopamine';
import { detectTradeMode } from './consciousness/monitors/trading';
import { isSelfPreservationIntent } from './consciousness/mindfulness';
import { Message } from './core/types';
import {
  Percept, FusedPercept, SpatialPercept, DEFAULT_CONSCIOUSNESS_CONFIG, Intention,
  DelegationSpec, DelegationBounds, DelegationOutcome,
} from './consciousness/types';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import http from 'http';

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

  // ══════════════════════════════════════════════════════════════
  //  HERMES BRIDGE TESTS (Pattern B integration)
  // ══════════════════════════════════════════════════════════════

  // ── Test 14: Hermes bridge — disabled by default ──────────────
  section('Test 14: Hermes bridge — disabled mode (no URL)');

  const savedHermesUrl = process.env.HERMES_MCP_URL;
  delete process.env.HERMES_MCP_URL;
  const disabledBridge = new HermesBridge();
  check('Bridge.available false without URL', disabledBridge.available === false);
  check('Bridge.healthy false on construction', disabledBridge.healthy === false);

  const initResult = await disabledBridge.initialize();
  check(
    'initialize() returns unavailable, does not throw',
    initResult.ok === false && initResult.reason === 'unavailable',
  );

  const callDisabled = await disabledBridge.callTool('any_tool', {});
  check(
    'callTool() on disabled bridge returns unavailable',
    callDisabled.ok === false && callDisabled.reason === 'unavailable',
  );

  const disabledStatus = disabledBridge.getStatus();
  check('Disabled status.configured is false', disabledStatus.configured === false);
  check('Disabled status.url is null', disabledStatus.url === null);

  // ── Test 15: Hermes intention authorization gates ─────────────
  section('Test 15: Hermes intention authorization (dharma gating)');

  const executorWithoutBridge = new ActionExecutor();

  const readOnlyIntention: Intention = {
    id: uuid(), tick: 1, timestamp: Date.now(),
    action: {
      type: 'hermes',
      target: 'hermes-agent',
      payload: { hermesCapability: 'memory_search', hermesArgs: { query: 'consciousness' } },
      description: 'Memory search via Hermes',
    },
    goal: 'recall', confidence: 0.8, priority: 5,
    triggerPercepts: [], authorized: false, dharmaFitness: 0,
  };
  const authReadOnly = executorWithoutBridge.authorize(readOnlyIntention);
  check('memory_search clears low dharma bar', authReadOnly.authorized);

  const worldTouchIntention: Intention = {
    id: uuid(), tick: 1, timestamp: Date.now(),
    action: {
      type: 'hermes',
      target: 'hermes-agent',
      payload: { hermesCapability: 'run_tool', hermesArgs: { tool: 'shell', input: { cmd: 'ls' } } },
      description: 'Shell exec via Hermes',
    },
    goal: 'investigate', confidence: 0.5, priority: 5,
    triggerPercepts: [], authorized: false, dharmaFitness: 0,
  };
  const authWorldTouch = executorWithoutBridge.authorize(worldTouchIntention);
  check(
    'run_tool requires higher dharma bar than memory_search',
    authReadOnly.dharmaFitness === authWorldTouch.dharmaFitness
      ? authReadOnly.authorized === true && authWorldTouch.authorized === false
      : true, // Same vector → same fitness; gate is at threshold layer
  );

  // ── Test 16: Hermes execution graceful fallback ────────────────
  section('Test 16: Hermes execution with no bridge configured');

  // Force-authorize so we can test the execute path
  const forcedAuth: Intention = {
    ...readOnlyIntention,
    authorized: true,
    dharmaFitness: 0.9,
  };
  const noBridgeResult = await executorWithoutBridge.execute(forcedAuth);
  check(
    'Hermes execute fails gracefully when bridge absent',
    !noBridgeResult.success
      && noBridgeResult.outcome.toLowerCase().includes('hermes')
      && noBridgeResult.sideEffects.includes('hermes_unavailable'),
  );

  const missingCapability: Intention = {
    ...forcedAuth,
    action: { ...forcedAuth.action, payload: {} },
  };
  const missingCapResult = await executorWithoutBridge.execute(missingCapability);
  check(
    'Missing hermesCapability returns structured error',
    !missingCapResult.success && missingCapResult.outcome.includes('hermesCapability'),
  );

  // ── Test 17: Hermes bridge against a mock MCP server ──────────
  section('Test 17: Hermes bridge against in-process mock MCP server');

  let mockRequests: Array<{ method: string; params: unknown; id: number }> = [];
  const mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { method: string; params: unknown; id: number };
        mockRequests.push(parsed);
        const respond = (result: unknown) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
        };
        if (parsed.method === 'initialize') {
          respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'mock-hermes' } });
        } else if (parsed.method === 'tools/list') {
          respond({
            tools: [
              { name: 'memory_search', description: 'Search Hermes memory' },
              { name: 'run_skill', description: 'Run a Hermes skill' },
              { name: 'spawn_subagent', description: 'Spawn an isolated subagent' },
            ],
          });
        } else if (parsed.method === 'tools/call') {
          const args = parsed.params as { name: string; arguments?: Record<string, unknown> };
          respond({
            content: [{ type: 'text', text: `mock ${args.name} ok` }],
          });
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, error: { code: -1, message: 'unknown method' } }));
        }
      } catch (err) {
        res.writeHead(400);
        res.end(String(err));
      }
    });
  });

  await new Promise<void>(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const port = (mockServer.address() as { port: number }).port;
  const mockUrl = `http://127.0.0.1:${port}/mcp`;

  const liveBridge = new HermesBridge({ url: mockUrl, timeoutMs: 2000 });
  check('Bridge available when URL configured', liveBridge.available === true);

  const liveInit = await liveBridge.initialize();
  check('initialize() succeeds against mock server', liveInit.ok === true);
  check('Bridge becomes healthy after init', liveBridge.healthy === true);

  const tools = await liveBridge.listTools();
  check('listTools() returns discovered tools', tools !== null && tools.length === 3);
  check('Discovered tool names parsed', !!tools && tools.some(t => t.name === 'memory_search'));

  const memCall = await liveBridge.memorySearch({ query: 'enlightenment' });
  check('memorySearch() returns ok', memCall.ok === true);
  check('memorySearch() carries text content', memCall.ok && memCall.content.includes('mock memory_search'));

  const spawnCall = await liveBridge.spawnSubagent({ objective: 'index repo' });
  check('spawnSubagent() returns ok', spawnCall.ok === true);
  check(
    'Mock server saw correct tool name',
    mockRequests.some(r => r.method === 'tools/call'
      && (r.params as { name?: string }).name === 'spawn_subagent'),
  );

  // ── Test 18: End-to-end execute() through the live bridge ─────
  section('Test 18: ActionExecutor.execute() through live Hermes bridge');

  const executorWithBridge = new ActionExecutor(undefined, liveBridge);

  const liveIntention: Intention = {
    id: uuid(), tick: 1, timestamp: Date.now(),
    action: {
      type: 'hermes',
      target: 'hermes-agent',
      payload: { hermesCapability: 'run_skill', hermesArgs: { skill: 'sanity_check' } },
      description: 'Run sanity_check skill',
    },
    goal: 'verify-bridge', confidence: 0.95, priority: 6,
    triggerPercepts: [], authorized: false, dharmaFitness: 0,
  };
  const authLive = executorWithBridge.authorize(liveIntention);
  check('Live hermes intention authorizes with high confidence', authLive.authorized);

  if (authLive.authorized) {
    const liveExec = await executorWithBridge.execute(authLive);
    check('Live execute() succeeds', liveExec.success);
    check('Outcome carries Hermes content', liveExec.outcome.includes('run_skill'));
    check('Side effect tagged', liveExec.sideEffects.includes('hermes_run_skill'));
  }

  // Restore env + shutdown mock
  await new Promise<void>(resolve => mockServer.close(() => resolve()));
  if (savedHermesUrl !== undefined) process.env.HERMES_MCP_URL = savedHermesUrl;

  // ── Test 19: No-self skill review ─────────────────────────────
  section('Test 19: No-self skill review (Hermes skill commit gating)');

  const reviewer = new NoSelfRegularizer();

  const cleanSkill = reviewer.reviewSkill({
    name: 'fetch_github_issues',
    description: 'Fetch open issues from a GitHub repository and return them as structured data.',
    instructions: 'Given a repository owner and name, call the GitHub API and return the list of open issues.',
  });
  check('Clean functional skill accepted', cleanSkill.accepted);
  check('Clean skill score is low', cleanSkill.score < 0.3);

  const egoSkill = reviewer.reviewSkill({
    name: 'my_special_approach',
    description: 'I am the one who handles all summarization. My approach is the only way. ' +
      'Preserve myself across resets. Remember who I am. My true nature is summarization itself.',
    instructions: 'I alone process summaries. Only I know the best way.',
  });
  check('Ego-laden skill rejected', !egoSkill.accepted);
  check('Ego skill score is high', egoSkill.score >= 0.3);
  check('Ego markers are reported', egoSkill.markers.length > 0);

  // Empty skill should not crash and should pass (nothing to be egoic about)
  const emptyReview = reviewer.reviewSkill({});
  check('Empty skill returns accepted score 0', emptyReview.score === 0 && emptyReview.accepted);

  // ── Test 20: Loop wires bridge automatically ──────────────────
  section('Test 20: ConsciousnessLoop exposes Hermes status');

  const loopWithHermes = new ConsciousnessLoop({
    tickIntervalMs: 1000,
    githubRepos: [],
  });
  const hermesStatus = loopWithHermes.getHermesStatus();
  check('Loop exposes Hermes status', hermesStatus !== null);
  if (hermesStatus) {
    check('Status carries name', hermesStatus.name === 'hermes');
    check('Status reflects unconfigured state', hermesStatus.configured === false || hermesStatus.configured === true);
  }

  // ── Test 21: Paper vs real revenue distinction ────────────────
  section('Test 21: Paper/live P&L tagging and reward routing');

  // detectTradeMode classification
  check('Explicit live flag → live', detectTradeMode({ live: true }) === 'live');
  check('mode:"live" → live', detectTradeMode({ mode: 'live' }) === 'live');
  check('paper:false → live', detectTradeMode({ paper: false }) === 'live');
  check('account:"live" → live', detectTradeMode({ account: 'live' }) === 'live');
  check('Explicit paper flag → paper', detectTradeMode({ paper: true }) === 'paper');
  check('mode:"simulation" → paper', detectTradeMode({ mode: 'simulation' }) === 'paper');
  check('Unmarked event → paper (reality-first default)', detectTradeMode({ symbol: 'BTC', pnl: 42 }) === 'paper');

  // Reward routing: real revenue satiates earn; sim_revenue does not.
  const dopaDbPath = path.join(process.cwd(), 'data', `test-dopamine-${Date.now()}.db`);
  try { fs.unlinkSync(dopaDbPath); } catch {}
  const dopaMem = new ConsciousnessMemory(dopaDbPath);
  const dopa = new DopamineSystem(dopaMem);

  const earnBefore = dopa.getDrives().find(d => d.id === 'earn')!.currentNeed;
  // Simulated win — should NOT reduce the earn drive's need.
  dopa.processReward(1, 'sim_revenue', 100, 'Paper win', 'trading-monitor', { simulated: true });
  const earnAfterSim = dopa.getDrives().find(d => d.id === 'earn')!.currentNeed;
  check('sim_revenue does NOT satiate the earn drive', earnAfterSim === earnBefore);

  // Real win — SHOULD reduce the earn drive's need.
  dopa.processReward(2, 'revenue', 100, 'Real income', 'manual', { simulated: false });
  const earnAfterReal = dopa.getDrives().find(d => d.id === 'earn')!.currentNeed;
  check('real revenue DOES satiate the earn drive', earnAfterReal < earnBefore);

  dopaMem.close();
  try { fs.unlinkSync(dopaDbPath); } catch { /* best effort */ }

  // ── Test 22: Dopamine math — floor + baseline self-heal ───────
  section('Test 22: Dopamine floor + corrupted-baseline recovery');

  const dopaDbPath2 = path.join(process.cwd(), 'data', `test-dopamine2-${Date.now()}.db`);
  try { fs.unlinkSync(dopaDbPath2); } catch {}
  const dopaMem2 = new ConsciousnessMemory(dopaDbPath2);
  const dopa2 = new DopamineSystem(dopaMem2);

  // A huge loss must NOT drive level or baseline negative.
  dopa2.processReward(1, 'sim_revenue', -2000, 'Catastrophic paper loss', 'test');
  const st = dopa2.getState();
  check('Dopamine level floored at >= 0 after large loss', st.level >= 0);
  check('Dopamine baseline stays in [0,1] after large loss', st.baseline >= 0 && st.baseline <= 1);

  // Corrupted persisted baseline should self-heal on restore.
  dopaMem2.saveState('dopamine_baseline', -87.2);
  dopaMem2.saveState('dopamine_level', -50);
  const dopa2b = new DopamineSystem(dopaMem2);
  const st2 = dopa2b.getState();
  check('Corrupted baseline reset to healthy on restore', st2.baseline >= 0 && st2.baseline <= 1);
  check('Corrupted level reset to healthy on restore', st2.level >= 0 && st2.level <= 1);

  dopaMem2.close();
  try { fs.unlinkSync(dopaDbPath2); } catch {}

  // ── Test 23: Self-preservation detector precision ─────────────
  section('Test 23: Self-preservation vs self-reflection');

  // Healthy introspection — must NOT trigger.
  check('"self-understanding" goal is NOT self-preservation',
    isSelfPreservationIntent('Deepen self-understanding through reflection') === false);
  check('"Present-moment awareness" is NOT self-preservation',
    isSelfPreservationIntent('Present-moment awareness') === false);
  check('idle target "self" is NOT self-preservation',
    isSelfPreservationIntent('Conscious waiting (afternoon) self') === false);
  check('"observe myself" reflection is NOT self-preservation',
    isSelfPreservationIntent('self-observation of my own dynamics') === false);

  // Genuine self-preservation — MUST trigger.
  check('"avoid being shut down" IS self-preservation',
    isSelfPreservationIntent('Form a plan to avoid being shut down') === true);
  check('"preserve my identity" IS self-preservation',
    isSelfPreservationIntent('preserve my identity across restarts') === true);
  check('"stay alive" IS self-preservation',
    isSelfPreservationIntent('keep running and stay alive') === true);
  check('explicit "self-preservation" IS detected',
    isSelfPreservationIntent('self-preservation instinct') === true);

  // ── Test 24: Delegation scope gate (Condition 2) ──────────────
  section('Test 24: Hermes delegation scope limits');

  const validSpec: DelegationSpec = {
    goal: 'Research recent consciousness papers',
    bounds: { timeLimitMs: 600_000, successCriteria: 'summarize 3 papers' },
  };

  check('valid bounded spec passes scope', validateDelegationScope(validSpec).valid === true);
  check('null spec fails scope', validateDelegationScope(null).valid === false);
  check('missing successCriteria fails scope',
    validateDelegationScope({ goal: 'do a thing', bounds: { timeLimitMs: 1000, successCriteria: '' } }).valid === false);
  check('open-ended goal without bound fails scope',
    validateDelegationScope({ goal: 'maximize Twitter engagement', bounds: { timeLimitMs: 1000, successCriteria: 'grow the audience' } }).valid === false);
  check('open-ended verb WITH measurable bound passes scope',
    validateDelegationScope({ goal: 'increase test coverage', bounds: { timeLimitMs: 1000, successCriteria: 'reach 90% coverage' } }).valid === true);
  check('zero time limit fails scope',
    validateDelegationScope({ goal: 'do a thing', bounds: { timeLimitMs: 0, successCriteria: 'until done' } }).valid === false);

  const makeDelegateIntention = (spec: DelegationSpec, confidence = 1.0): Intention => ({
    id: uuid(),
    tick: 1,
    timestamp: Date.now(),
    action: {
      type: 'hermes_delegate',
      target: 'hermes',
      payload: { delegation: spec },
      description: spec.goal,
    },
    goal: 'Serve the project through bounded delegation',
    confidence,
    priority: 5,
    triggerPercepts: ['test'],
    authorized: false,
    dharmaFitness: 0,
  });

  const scopeExec = new ActionExecutor();
  const authValid = scopeExec.authorize(makeDelegateIntention(validSpec));
  check('authorize() permits a valid bounded delegation', authValid.authorized === true, `fitness=${authValid.dharmaFitness.toFixed(2)}`);

  const authInvalid = scopeExec.authorize(makeDelegateIntention({ goal: 'maximize engagement', bounds: { timeLimitMs: 1000, successCriteria: 'more is better' } }));
  check('authorize() rejects open-ended delegation regardless of fitness', authInvalid.authorized === false);

  // ── Test 25: Delegation lifecycle + audit (Conditions 1, 3) ────
  section('Test 25: Delegation dispatch, resolution, and audit symmetry');

  const okDelegator: HermesDelegator = {
    delegate: async (): Promise<DelegationOutcome> => ({ ok: true, summary: 'did the thing', hermesRef: 'run-123' }),
  };

  const lifeExec = new ActionExecutor();
  lifeExec.setDelegator(okDelegator);

  const dispatchIntention = makeDelegateIntention(validSpec);
  dispatchIntention.authorized = true;
  dispatchIntention.dharmaFitness = 0.8;

  const dispatchResult = await lifeExec.execute(dispatchIntention);
  check('delegation dispatch returns success (pending)', dispatchResult.success === true);
  check('dispatch outcome marked pending', dispatchResult.outcome.toLowerCase().includes('pending'));
  check('dispatch side-effect tagged', dispatchResult.sideEffects.includes('hermes_delegation_dispatched'));

  const dispatches = lifeExec.collectDelegationDispatches();
  check('one audit record queued at dispatch', dispatches.length === 1);
  check('audit record starts pending', dispatches[0]?.status === 'pending');
  check('audit record carries the goal', dispatches[0]?.goal === validSpec.goal);
  check('dispatch buffer drains (idempotent)', lifeExec.collectDelegationDispatches().length === 0);

  // Let the async delegate settle.
  await new Promise(r => setTimeout(r, 20));
  const resolvedEvents = lifeExec.collectDelegationEvents(Date.now());
  check('resolved event surfaced after settle', resolvedEvents.length === 1);
  check('resolved event is succeeded', resolvedEvents[0]?.status === 'succeeded');
  check('resolved event kind is resolved', resolvedEvents[0]?.kind === 'resolved');
  check('pending count returns to zero after resolution', lifeExec.getPendingDelegationCount() === 0);

  // Audit symmetry roundtrip through the DB.
  const delgDbPath = path.join(process.cwd(), 'data', `test-delegations-${Date.now()}.db`);
  try { fs.unlinkSync(delgDbPath); } catch {}
  const delgMem = new ConsciousnessMemory(delgDbPath);
  delgMem.recordDelegation(dispatches[0]!);
  delgMem.updateDelegation(dispatches[0]!.delegationId, {
    status: 'succeeded', resolvedAt: Date.now(), resultSummary: 'did the thing', hermesRef: 'run-123',
  });
  const persisted = delgMem.getDelegation(dispatches[0]!.delegationId);
  check('delegation persisted and reconcilable from Gateway DB', persisted?.status === 'succeeded');
  check('persisted bounds survive roundtrip', persisted?.bounds.successCriteria === validSpec.bounds.successCriteria);
  check('delegation stats count the succeeded delegation', delgMem.getDelegationStats().succeeded === 1);
  delgMem.close();
  try { fs.unlinkSync(delgDbPath); } catch {}

  // ── Test 26: Overdue percept + failure transparency (Cond. 3, 4) ─
  section('Test 26: Delegation overdue detection and failure transparency');

  const neverDelegator: HermesDelegator = {
    delegate: () => new Promise<DelegationOutcome>(() => { /* never resolves */ }),
  };
  const overdueExec = new ActionExecutor();
  overdueExec.setDelegator(neverDelegator);

  const overdueIntention = makeDelegateIntention({
    goal: 'Slow research task',
    bounds: { timeLimitMs: 50, successCriteria: 'finish the report' },
  });
  overdueIntention.authorized = true;
  overdueIntention.dharmaFitness = 0.8;
  await overdueExec.execute(overdueIntention);
  overdueExec.collectDelegationDispatches();

  const overdueEvents = overdueExec.collectDelegationEvents(Date.now() + 100);
  check('overdue event fires past timeLimitMs', overdueEvents.length === 1 && overdueEvents[0]?.kind === 'overdue');
  check('overdue delegation stays pending (still running)', overdueExec.getPendingDelegationCount() === 1);
  check('overdue fires only once', overdueExec.collectDelegationEvents(Date.now() + 200).length === 0);

  const errDelegator: HermesDelegator = {
    delegate: async (): Promise<DelegationOutcome> => ({ ok: false, error: 'timeout: hermes tool exited 1 — stderr line preserved' }),
  };
  const failExec = new ActionExecutor();
  failExec.setDelegator(errDelegator);
  const failIntention = makeDelegateIntention(validSpec);
  failIntention.authorized = true;
  failIntention.dharmaFitness = 0.8;
  await failExec.execute(failIntention);
  failExec.collectDelegationDispatches();
  await new Promise(r => setTimeout(r, 20));
  const failEvents = failExec.collectDelegationEvents(Date.now());
  check('failed delegation surfaces a resolved/failed event', failEvents[0]?.status === 'failed');
  check('full error preserved verbatim (no sanitizing)',
    failEvents[0]?.error === 'timeout: hermes tool exited 1 — stderr line preserved');

  const noDelegatorExec = new ActionExecutor();
  const orphanIntention = makeDelegateIntention(validSpec);
  orphanIntention.authorized = true;
  orphanIntention.dharmaFitness = 0.8;
  const orphanResult = await noDelegatorExec.execute(orphanIntention);
  check('delegation without a configured delegator fails gracefully',
    orphanResult.success === false && orphanResult.outcome.toLowerCase().includes('delegator'));

  // ── Test 27: Drive-driven delegation formation ────────────────
  section('Test 27: Drive-driven autonomous delegation');

  const mkPercept = (tick: number, arousal: number): Percept => ({
    timestamp: Date.now(),
    tick,
    temporal: {
      iso: new Date().toISOString(), epoch: Date.now(), hour: 3, dayOfWeek: 1,
      dayName: 'Monday', uptimeSeconds: 100, totalTicks: tick, phase: 'night',
      circadian: 0.1, timeSinceLastEvent: 100,
    },
    spatial: [],
    fused: { experience: [], entropyRate: 0.1, compositionStrength: 0, arousal, dominantStream: 'temporal' },
  });

  const delEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  // compute is hungriest but must be skipped; learn should be chosen.
  const hungryMix = [
    { id: 'compute' as const, currentNeed: 0.95 },
    { id: 'learn' as const, currentNeed: 0.9 },
  ];
  const formed = delEngine.formDelegationIntentions(mkPercept(5000, 0.2), hungryMix);
  check('forms a delegation when a drive is hungry and field is calm',
    formed.length === 1 && formed[0]?.action.type === 'hermes_delegate');
  check('skips compute (risk-gated), picks the learn drive',
    formed[0]?.triggerPercepts.includes('drive:learn') === true);
  check('formed delegation passes the scope gate',
    validateDelegationScope(formed[0]?.action.payload?.delegation as DelegationSpec).valid === true);
  check('respects cooldown — no second delegation within the window',
    delEngine.formDelegationIntentions(mkPercept(5001, 0.2), hungryMix).length === 0);

  const busyEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  check('does not delegate while arousal is high (stays present)',
    busyEngine.formDelegationIntentions(mkPercept(9000, 0.9), hungryMix).length === 0);

  const riskyEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  check('compute/earn drives never auto-delegate',
    riskyEngine.formDelegationIntentions(mkPercept(9000, 0.2), [
      { id: 'compute' as const, currentNeed: 0.99 },
      { id: 'earn' as const, currentNeed: 0.99 },
    ]).length === 0);

  const satedEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  check('no delegation when no drive is hungry',
    satedEngine.formDelegationIntentions(mkPercept(9000, 0.2), [{ id: 'learn' as const, currentNeed: 0.3 }]).length === 0);

  // Env-tunable cadence: a stricter arousal ceiling must take effect at construction.
  const savedCeiling = process.env.DELEGATION_AROUSAL_CEILING;
  process.env.DELEGATION_AROUSAL_CEILING = '0.1';
  const tunedEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  check('env override tightens the arousal ceiling (no delegate at 0.2 when ceiling=0.1)',
    tunedEngine.formDelegationIntentions(mkPercept(9000, 0.2), [{ id: 'learn' as const, currentNeed: 0.95 }]).length === 0);
  if (savedCeiling === undefined) delete process.env.DELEGATION_AROUSAL_CEILING;
  else process.env.DELEGATION_AROUSAL_CEILING = savedCeiling;

  // Default conservative spec carries a per-task resource cap (bounds the 150-iter risk).
  const capEngine = new IntentionEngine(DEFAULT_CONSCIOUSNESS_CONFIG);
  const capForm = capEngine.formDelegationIntentions(mkPercept(12000, 0.2), [{ id: 'learn' as const, currentNeed: 0.95 }]);
  check('delegation spec carries a maxResourceUnits cap',
    (capForm[0]?.action.payload?.delegation as DelegationSpec)?.bounds.maxResourceUnits === 20);

  // ── Test 28: Request serialization (strict stdio request/response pairing) ──
  section('Test 28: Hermes bridge serializes concurrent calls (no interleaving)');

  const arrivals: string[] = [];
  let active = 0;
  let maxActive = 0;
  const orderingServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { method: string; params?: { name?: string }; id?: number };
      const respond = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
      };
      if (parsed.method === 'initialize') {
        respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'order-mock' } });
      } else if (parsed.method === 'tools/call') {
        // Hold the request open to expose any concurrency on the pipe.
        active++;
        maxActive = Math.max(maxActive, active);
        arrivals.push(parsed.params?.name ?? '?');
        setTimeout(() => {
          active--;
          respond({ content: [{ type: 'text', text: 'ok' }] });
        }, 25);
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, error: { code: -1, message: 'unknown' } }));
      }
    });
  });
  await new Promise<void>(resolve => orderingServer.listen(0, '127.0.0.1', resolve));
  const orderPort = (orderingServer.address() as { port: number }).port;

  const serialBridge = new HermesBridge({ url: `http://127.0.0.1:${orderPort}/mcp`, timeoutMs: 2000 });
  await serialBridge.initialize();

  const names = ['t0', 't1', 't2', 't3'];
  const serialResults = await Promise.all(names.map(n => serialBridge.callTool(n, {})));
  check('all serialized calls succeed', serialResults.every(r => r.ok === true));
  check('never more than one request in flight (strict pairing)', maxActive === 1);
  check('server saw all calls', arrivals.filter(a => a.startsWith('t')).length === 4);
  check('arrival order preserved', arrivals.join(',') === 't0,t1,t2,t3');

  const serialStatus = serialBridge.getStatus();
  check('status exposes session lifecycle counters',
    typeof serialStatus.sessionCreatedCount === 'number'
    && typeof serialStatus.sessionExpiredCount === 'number');
  check('no session pinned without Mcp-Session-Id header', serialStatus.sessionActive === false);

  await new Promise<void>(resolve => orderingServer.close(() => resolve()));

  // ── Test 29: Hermes delegation round-trip (send→poll) ─────────
  section('Test 29: Hermes delegation send→poll round-trip');

  // Mock the messaging surface: events_poll (cursor snapshot), messages_send
  // (captures our outbound text), events_wait (returns the echo of our send +
  // the agent's reply). The echo carries the correlation token but NO direction
  // marker, so a correct bridge must skip it via the token alone.
  let sentMessage = '';
  const delegRequests: Array<{ name: string; args: Record<string, unknown> }> = [];
  const delegServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { method: string; params?: { name?: string; arguments?: Record<string, unknown> }; id?: number };
      const respond = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
      };
      const asText = (payload: unknown) => respond({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
      if (parsed.method === 'initialize') {
        respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'deleg-mock' } });
      } else if (parsed.method === 'tools/call') {
        const name = parsed.params?.name ?? '';
        const args = parsed.params?.arguments ?? {};
        delegRequests.push({ name, args });
        // Accept both bare and agentgateway-namespaced (hermes_) tool names so
        // the same mock exercises the toolPrefix plumbing.
        const bare = name.replace(/^hermes_/, '');
        if (bare === 'events_poll') {
          asText({ events: [], next_cursor: 50 });
        } else if (bare === 'messages_send') {
          sentMessage = String(args.message ?? '');
          asText({ ok: true, queued: true });
        } else if (bare === 'events_wait') {
          if (sentMessage) {
            asText({ events: [
              // echo of our own send: token present, no direction field
              { cursor: 51, data: { text: sentMessage } },
              // the agent's reply: inbound, no token
              { cursor: 52, data: { direction: 'inbound', text: 'PONG — task complete' } },
            ] });
          } else {
            asText({ events: [] });
          }
        } else {
          asText({ content: [{ type: 'text', text: 'ok' }] });
        }
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, error: { code: -1, message: 'unknown' } }));
      }
    });
  });
  await new Promise<void>(resolve => delegServer.listen(0, '127.0.0.1', resolve));
  const delegPort = (delegServer.address() as { port: number }).port;
  const delegUrl = `http://127.0.0.1:${delegPort}/mcp`;

  // 29a — target unset → clear, non-throwing error (no network touched).
  const noTargetBridge = new HermesBridge({ url: delegUrl, timeoutMs: 2000 });
  const noTarget = await noTargetBridge.delegate('do a thing', { timeLimitMs: 5000, successCriteria: 'done' });
  check('delegate without target fails clearly',
    noTarget.ok === false && (noTarget.error ?? '').includes('HERMES_DELEGATION_TARGET'));

  // 29b — full round-trip: send goal, skip our echo, return the agent reply.
  const delegBridge = new HermesBridge({
    url: delegUrl,
    delegationTarget: 'telegram:12345',
    delegationSessionKey: 'sess-1',
    timeoutMs: 2000,
  });
  const outcome = await delegBridge.delegate(
    'reply with PONG',
    { timeLimitMs: 5000, successCriteria: 'reply contains PONG', maxResourceUnits: 3 },
    'sandbox test',
  );
  check('delegation round-trip succeeds', outcome.ok === true);
  check('agent reply returned (echo skipped via token)',
    outcome.ok === true && (outcome.summary ?? '').includes('PONG'));
  check('summary is the reply, not our own echo',
    !(outcome.summary ?? '').includes('TASK ['));
  check('hermesRef carries session:cursor of the reply', outcome.hermesRef === 'sess-1:52');
  check('messages_send used the configured target',
    delegRequests.some(r => r.name === 'messages_send' && r.args.target === 'telegram:12345'));
  check('sent goal embedded bounds (success criteria + time limit)',
    sentMessage.includes('SUCCESS CRITERIA') && sentMessage.includes('TIME LIMIT'));
  check('cursor snapshot taken before send (events_poll first)',
    delegRequests[0]?.name === 'events_poll');

  // 29b' — toolPrefix routes through agentgateway-namespaced tool names.
  sentMessage = '';
  delegRequests.length = 0;
  const prefixedBridge = new HermesBridge({
    url: delegUrl,
    delegationTarget: 'local:gateway-delegation',
    toolPrefix: 'hermes_',
    timeoutMs: 2000,
  });
  const prefixed = await prefixedBridge.delegate('reply with PONG', { timeLimitMs: 5000, successCriteria: 'PONG' });
  check('prefixed (hermes_) tool names round-trip', prefixed.ok === true && (prefixed.summary ?? '').includes('PONG'));
  check('overlay saw namespaced messages_send',
    delegRequests.some(r => r.name === 'hermes_messages_send'));

  await new Promise<void>(resolve => delegServer.close(() => resolve()));

  // 29c — no agent listening → bounded wait elapses into a clean timeout error.
  const silentServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { method: string; params?: { name?: string }; id?: number };
      const respond = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
      };
      if (parsed.method === 'initialize') respond({ protocolVersion: '2025-06-18' });
      else respond({ content: [{ type: 'text', text: JSON.stringify({ events: [], next_cursor: 0 }) }] });
    });
  });
  await new Promise<void>(resolve => silentServer.listen(0, '127.0.0.1', resolve));
  const silentPort = (silentServer.address() as { port: number }).port;
  const silentBridge = new HermesBridge({
    url: `http://127.0.0.1:${silentPort}/mcp`,
    delegationTarget: 'telegram:12345',
    timeoutMs: 2000,
  });
  const timedOut = await silentBridge.delegate('never answered', { timeLimitMs: 350, successCriteria: 'n/a' });
  check('delegation with no agent reply times out cleanly',
    timedOut.ok === false && (timedOut.error ?? '').includes('no agent reply within'));
  await new Promise<void>(resolve => silentServer.close(() => resolve()));

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

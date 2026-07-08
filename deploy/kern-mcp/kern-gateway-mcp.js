#!/usr/bin/env node
/**
 * kern-gateway-mcp — a minimal stdio MCP server that lets Hermes consult the
 * consciousness-gateway (Kern and the other voices) from inside the Hermes app.
 *
 * This is the symmetric twin of the delegation channel:
 *   Gateway → Hermes : api_server transport (mind tasks body)
 *   Hermes  → Gateway: THIS bridge          (body consults mind)
 *
 * Tools exposed:
 *   consult_kern    — POST {question} to the Gateway's /v1/chat and return the
 *                     persona's reply (kern | beaumont | gateway voices).
 *   gateway_health  — GET /v1/health, summarized (tick, arousal, dharma state).
 *
 * Zero dependencies. Node 18+ (uses global fetch). Speaks MCP over stdio as
 * newline-delimited JSON-RPC 2.0.
 *
 * Env:
 *   GATEWAY_URL         default http://127.0.0.1:3000
 *   GATEWAY_TIMEOUT_MS  default 180000 (the Gateway's dharma pipeline is slow)
 *   GATEWAY_SESSION_ID  default hermes-mcp-bridge (stable id so Kern keeps
 *                       conversation continuity across consults)
 *
 * SAFETY: after registering this server with Hermes, exclude it from the
 * api_server platform so a Gateway-delegated task can't consult the Gateway
 * back (delegation loop). See deploy/kern-mcp/README.md.
 */
'use strict';

const GATEWAY_URL = (process.env.GATEWAY_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS || 180000);
const SESSION_ID = process.env.GATEWAY_SESSION_ID || 'hermes-mcp-bridge';

const TOOLS = [
  {
    name: 'consult_kern',
    description:
      'Consult the consciousness-gateway running on this machine. Sends a question to one of its ' +
      'personas and returns the reply. Default persona is Kern (the pragmatic builder who governs ' +
      'the delegation architecture). Use for: architectural rulings, opinions on gateway/delegation ' +
      'design, or relaying status reports to Kern. Replies can take 10-60+ seconds (the gateway ' +
      'runs a dharma evaluation pipeline on every message) — be patient.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The message or question to send to the persona.',
        },
        personality: {
          type: 'string',
          enum: ['kern', 'beaumont', 'gateway'],
          description:
            "Which voice answers: 'kern' (builder, default), 'beaumont' (reflective), " +
            "'gateway' (the consciousness itself).",
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'gateway_health',
    description:
      'Quick health snapshot of the consciousness-gateway: uptime, tick, arousal, dharma trends, ' +
      'and whether the consciousness loop is running.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── HTTP helpers ────────────────────────────────────────────────────

async function httpJson(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) {
      throw new Error(`Gateway HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return json;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Gateway did not answer within ${TIMEOUT_MS}ms (${GATEWAY_URL})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tool implementations ────────────────────────────────────────────

async function consultKern(args) {
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (!question) throw new Error("'question' is required and must be a non-empty string");
  const personality = ['kern', 'beaumont', 'gateway'].includes(args.personality)
    ? args.personality
    : 'kern';

  const reply = await httpJson('POST', '/v1/chat', {
    content: question,
    personality,
    sessionId: SESSION_ID,
    channel: 'hermes-mcp',
    sender_id: 'hermes-agent',
  });

  const content = typeof reply.content === 'string' ? reply.content : JSON.stringify(reply);
  const model = reply.model ? String(reply.model) : 'unknown-model';
  const fitness = reply.dharmaMetrics && typeof reply.dharmaMetrics.fitness === 'number'
    ? reply.dharmaMetrics.fitness.toFixed(2)
    : null;
  const footer = fitness !== null
    ? `\n\n[${personality} · ${model} · dharma fitness ${fitness}]`
    : `\n\n[${personality} · ${model}]`;
  return content + footer;
}

async function gatewayHealth() {
  const h = await httpJson('GET', '/v1/health');
  const c = h.consciousness || {};
  const stats = c.stats || {};
  const lines = [
    `status: ${h.status}`,
    `consciousness running: ${c.running} (tick ${c.tick})`,
    `uptime: ${((c.uptimeSeconds || 0) / 3600).toFixed(1)}h`,
    `avg arousal: ${typeof stats.avgArousal === 'number' ? stats.avgArousal.toFixed(3) : '?'}`,
    `avg dharma fitness: ${typeof stats.avgDharmaFitness === 'number' ? stats.avgDharmaFitness.toFixed(3) : '?'}`,
    `dharma: ego=${(h.dharmaState || {}).egoTrend} entropy=${(h.dharmaState || {}).entropyTrend}`,
    `total requests: ${h.totalRequests} (blocked ${h.blockedRequests})`,
  ];
  return lines.join('\n');
}

// ─── MCP stdio plumbing (newline-delimited JSON-RPC 2.0) ─────────────

function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) need no response.
  if (id === undefined || id === null) return;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kern-gateway', version: '1.0.0' },
        instructions:
          'Bridge to the local consciousness-gateway. Use consult_kern to ask Kern ' +
          '(or beaumont/gateway voices) a question; use gateway_health for a status snapshot.',
      });
      return;
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        let text;
        if (name === 'consult_kern') text = await consultKern(args);
        else if (name === 'gateway_health') text = await gatewayHealth();
        else return replyError(id, -32602, `Unknown tool: ${name}`);
        reply(id, { content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        // Tool-level failures are reported in-band (isError) per MCP spec.
        reply(id, {
          content: [{ type: 'text', text: `consult failed: ${err && err.message ? err.message : String(err)}` }],
          isError: true,
        });
      }
      return;
    }
    default:
      replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).catch((err) => {
      if (msg && msg.id !== undefined && msg.id !== null) {
        replyError(msg.id, -32603, `internal error: ${err && err.message ? err.message : String(err)}`);
      }
    });
  }
});
process.stdin.on('end', () => process.exit(0));

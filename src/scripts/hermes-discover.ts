/**
 * Hermes delegation discovery — read the LIVE target + session_key off the
 * running overlay so we never hard-code guesses into the smoke test / Gateway
 * env. Run this on the Mac Mini after the overlay is up AND you've messaged the
 * delegation bot at least once (so a conversation exists).
 *
 * Usage:
 *   HERMES_MCP_URL=http://127.0.0.1:7821/mcp \
 *   HERMES_TOOL_PREFIX=hermes_ \
 *   npx ts-node src/scripts/hermes-discover.ts
 *
 * It prints channels_list + conversations_list verbatim. From those:
 *   - HERMES_DELEGATION_TARGET       ← the channel/target address (e.g. telegram:8217238229)
 *   - HERMES_DELEGATION_SESSION_KEY  ← the conversation's session_key
 */

import { HermesBridge } from '../agents/providers/hermes';

const url = process.env.HERMES_MCP_URL;
const authToken = process.env.HERMES_AUTH_TOKEN;
const prefix = process.env.HERMES_TOOL_PREFIX ?? '';

async function dump(bridge: HermesBridge, tool: string): Promise<void> {
  const name = `${prefix}${tool}`;
  const r = await bridge.callTool(name, {});
  console.log(`\n===== ${name} =====`);
  if (r.ok) {
    console.log(r.content || '(empty)');
  } else {
    console.log(`  [${r.reason}] ${'detail' in r ? r.detail ?? '' : ''}`);
  }
}

async function main(): Promise<void> {
  if (!url) {
    console.error('HERMES_MCP_URL is not set (e.g. http://127.0.0.1:7821/mcp).');
    process.exit(2);
  }
  const bridge = new HermesBridge({ url, authToken, toolPrefix: prefix, timeoutMs: 15_000 });
  const init = await bridge.initialize();
  if (!init.ok) {
    console.error(`Overlay not reachable at ${url}: ${'detail' in init ? init.detail ?? '' : ''}`);
    console.error('Is the agentgateway overlay running (and the hermes target up)?');
    process.exit(2);
  }
  console.log(`Overlay reachable at ${url} — handshake ok.`);

  const tools = await bridge.listTools();
  if (tools) {
    console.log(`\nAdvertised tools (${tools.length}): ${tools.map(t => t.name).join(', ')}`);
  }

  await dump(bridge, 'channels_list');
  await dump(bridge, 'conversations_list');

  console.log(
    '\nNext: set HERMES_DELEGATION_TARGET to the channel address and ' +
      'HERMES_DELEGATION_SESSION_KEY to the conversation session_key, then run the smoke test with HAPPY=1.',
  );
}

main().catch(err => {
  console.error('discovery crashed:', err);
  process.exit(3);
});

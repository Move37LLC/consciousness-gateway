/**
 * Live architecture snapshot for personality context.
 *
 * Replaces the hand-maintained provider/model prose in the master-context
 * markdown files, which drifted out of date the moment a provider was added
 * (Kern confidently reported it had no Moonshot provider the day after one
 * shipped). Generated fresh from the live ProviderRegistry and DEFAULT_CONFIG
 * on every request, so it can never go stale.
 */

import { DEFAULT_CONFIG } from '../core/config';
import { ProviderRegistry } from '../agents/providers';

let registry: ProviderRegistry | null = null;

function getRegistry(): ProviderRegistry {
  // Lazily constructed and reused: ProviderRegistry reads availability from
  // env at call time, so a single instance reflects the current key set.
  if (!registry) registry = new ProviderRegistry();
  return registry;
}

export function buildArchitectureSection(): string {
  const status = getRegistry().getStatus();
  const available = new Set(status.filter(s => s.available).map(s => s.name));

  const lines: string[] = [];
  lines.push('─── LIVE ARCHITECTURE (generated — authoritative) ───');
  lines.push('This block is generated from the running provider registry. Trust it over');
  lines.push('any provider list in the foundational documents above, which are static.');

  for (const provider of DEFAULT_CONFIG.providers) {
    const isAvailable = available.has(provider.id);
    const marker = isAvailable ? '✓' : '✗ (no API key)';
    lines.push('', `${provider.name} — ${marker}`);
    for (const model of provider.models) {
      const ctx = model.maxTokens >= 1000
        ? `${Math.round(model.maxTokens / 1000)}k ctx`
        : `${model.maxTokens} ctx`;
      const vision = model.capabilities.vision ? ', vision' : '';
      lines.push(`  ${isAvailable ? '✓' : ' '} ${model.id} (${ctx}${vision})`);
    }
  }

  const availableCount = status.filter(s => s.available && s.name !== 'fallback').length;
  lines.push(
    '',
    `${availableCount} provider(s) live right now. A model marked ✗ has a`,
    'registered provider but no API key in the environment — it can be enabled',
    'by adding the key and restarting, no code change required.',
  );

  return lines.join('\n');
}

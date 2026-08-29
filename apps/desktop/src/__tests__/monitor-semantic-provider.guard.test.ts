import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const source = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('monitor semantic provider boundary', () => {
  it('routes idle triage and catch-up only through runMonitor', () => {
    const host = source('apps/desktop/src/host.ts');

    for (const promptId of ['builtin:idle-triage', 'builtin:catch-up-summary']) {
      const start = host.indexOf(`promptRegistry.get('${promptId}')`);
      expect(start, `${promptId} dispatch missing`).toBeGreaterThanOrEqual(0);
      const block = host.slice(start, start + 700);
      expect(block).toContain('llmService.runMonitor(');
      expect(block).not.toContain('llmService.run(entry');
    }
  });

  it('does not ship claude-cli as a monitor prompt provider', () => {
    const registry = source('packages/llm/src/prompt-registry.ts');
    for (const promptId of ['builtin:idle-triage', 'builtin:catch-up-summary']) {
      const start = registry.indexOf(`id: '${promptId}'`);
      expect(start, `${promptId} prompt missing`).toBeGreaterThanOrEqual(0);
      const block = registry.slice(start, start + 1_500);
      expect(block).toContain("provider: 'openai'");
      expect(block).not.toContain("provider: 'claude-cli'");
    }
  });
});

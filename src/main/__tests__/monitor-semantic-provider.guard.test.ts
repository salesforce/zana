import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = (name: string) => readFileSync(resolve(root, name), 'utf8');

describe('monitor semantic provider boundary', () => {
  it('routes idle triage and catch-up only through runMonitor', () => {
    const index = source('index.ts');

    for (const promptId of ['builtin:idle-triage', 'builtin:catch-up-summary']) {
      const start = index.indexOf(`promptRegistry.get('${promptId}')`);
      expect(start, `${promptId} dispatch missing`).toBeGreaterThanOrEqual(0);
      const block = index.slice(start, start + 700);
      expect(block).toContain('llmService.runMonitor(');
      expect(block).not.toContain('llmService.run(entry');
    }
  });

  it('does not ship claude-cli as a monitor prompt provider', () => {
    const registry = source('prompt-registry.ts');
    for (const promptId of ['builtin:idle-triage', 'builtin:catch-up-summary']) {
      const start = registry.indexOf(`id: '${promptId}'`);
      expect(start, `${promptId} prompt missing`).toBeGreaterThanOrEqual(0);
      const block = registry.slice(start, start + 1_500);
      expect(block).toContain("provider: 'openai'");
      expect(block).not.toContain("provider: 'claude-cli'");
    }
  });
});

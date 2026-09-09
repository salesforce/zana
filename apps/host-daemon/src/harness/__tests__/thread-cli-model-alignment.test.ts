import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { providerFor } from '../registry.js';
import { resolveModelTarget } from '../target-resolution.js';

const config = (): AppConfig => ({
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
});

/**
 * Thread / Modern fallback catalog ids that CLI Agent also sends as
 * `modelTargetId`. Keep in lockstep with `fallback-models.ts` (Claude, Codex,
 * Cursor ACP primary list).
 */
const THREAD_CATALOG_BY_FAMILY = {
  claude: ['claude-fable-5', 'claude-opus-5[1m]', 'claude-sonnet-5'],
  cursor: ['default', 'grok-4.6', 'gpt-5.6-sol', 'claude-opus-5', 'claude-fable-5', 'composer-2.5'],
  codex: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6-sol'],
  grok: ['grok-4.5', 'grok-4.6']
} as const;

describe('thread catalog ↔ CLI Agent PTY launch alignment', () => {
  it('resolves every shared thread-catalog id without Unknown model target', () => {
    for (const [family, ids] of Object.entries(THREAD_CATALOG_BY_FAMILY)) {
      const provider = providerFor(family as 'claude' | 'cursor' | 'codex' | 'grok');
      expect(provider.acceptsUnlistedModelTargets, `${family} must accept thread-catalog ids`).toBe(true);
      for (const modelTargetId of ids) {
        expect(() => resolveModelTarget(provider, {
          config: config(),
          profile: family as 'claude' | 'cursor' | 'codex' | 'grok',
          extraArgs: [],
          perTabRouting: {
            schemaVersion: 1,
            byAdapter: { [family]: { modelTargetId } }
          },
          scope: 'local'
        }), `${family}:${modelTargetId}`).not.toThrow();
      }
    }
  });
});

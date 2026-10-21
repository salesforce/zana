import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { reconcileHarnessConfig } from './config-harness-refresh.js';

const config = (patch: Partial<AppConfig> = {}) => ({ claudeBinary: 'claude', ...patch } as AppConfig);
const effects = () => ({ invalidate: vi.fn() });

describe('committed harness config refresh', () => {
  it.each(['claudeBinary', 'cursorBinary', 'codexBinary', 'piBinary', 'opencodeBinary', 'grokBinary', 'mastracodeBinary', 'afcodeBinary'] as const)('invalidates after %s changes', key => {
    const hooks = effects();
    const next = config({ [key]: '/new/binary' });
    reconcileHarnessConfig(config(), next, hooks);
    expect(hooks.invalidate).toHaveBeenCalledOnce();
  });
  it('invalidates after a canonical binary change without rebuilding providers (the getter reads live)', () => {
    const hooks = effects();
    const previous = config({ harnesses: { byId: { claude: { binary: '/old/claude' } } } });
    const next = config({ harnesses: { byId: { claude: { binary: '/new/claude' } } } });
    reconcileHarnessConfig(previous, next, hooks);
    expect(hooks.invalidate).toHaveBeenCalledOnce();
  });
  it('invalidates canonical enable changes without rebuilding an unchanged provider', () => {
    const hooks = effects();
    reconcileHarnessConfig(config(), config({ harnesses: { byId: { cursor: { enabled: true } } } }), hooks);
    expect(hooks.invalidate).toHaveBeenCalledOnce();
  });
  it('keeps a canonical provider when only a stale compatibility field changes', () => {
    const hooks = effects();
    const previous = config({ harnesses: { byId: { claude: { binary: '/canonical' } } } });
    reconcileHarnessConfig(previous, { ...previous, claudeBinary: '/stale' }, hooks);
  });
  it('ignores identical settings and unrelated preferences', () => {
    const hooks = effects();
    const previous = config({ harnesses: { byId: { claude: { binary: '/same' } } } });
    reconcileHarnessConfig(previous, { ...previous, theme: 'light', harnesses: structuredClone(previous.harnesses) }, hooks);
    expect(hooks.invalidate).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { runStartupGate } from './startup-gate.js';
import { MigrationRepairRequiredError } from '@zana-ai/zcc-server/services/harness-routing/journal';

describe('runStartupGate', () => {
  it('finishes migration before config/provider reads, scheduler, goals, and normal launch', async () => {
    const order: string[] = [];
    const state = await runStartupGate({
      migrate: async () => { order.push('migration'); },
      launchNormal: async () => {
        order.push('config/provider');
        order.push('scheduler');
        order.push('goals');
        order.push('window');
      }
    });

    expect(state).toEqual({ mode: 'ready' });
    expect(order).toEqual(['migration', 'config/provider', 'scheduler', 'goals', 'window']);
  });

  it('awaits launch reconciliation inside normal bootstrap before launch services start', async () => {
    const order: string[] = [];
    let finishReconciliation!: () => void;
    const reconciliation = new Promise<void>((resolve) => { finishReconciliation = resolve; });
    const pending = runStartupGate({
      migrate: async () => undefined,
      launchNormal: async () => {
        order.push('reconcile-start');
        await reconciliation;
        order.push('scheduler-start');
      }
    });
    await Promise.resolve();
    expect(order).toEqual(['reconcile-start']);
    finishReconciliation();
    await pending;
    expect(order).toEqual(['reconcile-start', 'scheduler-start']);
  });

  it('retries a pre-canonical interruption before allowing first owning writes', async () => {
    const migrate = vi.fn()
      .mockRejectedValueOnce(new Error('pre-canonical'))
      .mockResolvedValueOnce({ migrated: 1, noOp: false });
    const launchNormal = vi.fn();

    const state = await runStartupGate({ migrate, launchNormal });

    expect(state).toEqual({ mode: 'ready' });
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(launchNormal).toHaveBeenCalledOnce();
  });

  it('recovers on restart after a failed attempt without launching early', async () => {
    const launchNormal = vi.fn();
    const first = await runStartupGate({
      migrate: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      launchNormal
    });
    expect(first).toEqual({ mode: 'repair-required', reason: 'harness-routing-migration' });
    expect(launchNormal).not.toHaveBeenCalled();

    const second = await runStartupGate({ migrate: async () => undefined, launchNormal });
    expect(second).toEqual({ mode: 'ready' });
    expect(launchNormal).toHaveBeenCalledOnce();
  });

  it('returns redacted repair state and prevents normal services after migration repair failure', async () => {
    const launchNormal = vi.fn();
    const state = await runStartupGate({
      migrate: async () => { throw new MigrationRepairRequiredError('/secret/home/.zcc/config.json external-edit'); },
      launchNormal
    });

    expect(state).toEqual({ mode: 'repair-required', reason: 'harness-routing-migration' });
    expect(JSON.stringify(state)).not.toContain('/secret');
    expect(launchNormal).not.toHaveBeenCalled();
  });

  it('awaits repair presentation before returning repair-required state', async () => {
    const order: string[] = [];
    const state = await runStartupGate({
      migrate: async () => { throw new MigrationRepairRequiredError('external-edit'); },
      launchNormal: vi.fn(),
      onRepairRequired: async () => {
        await Promise.resolve();
        order.push('repair-window');
      }
    });

    expect(state.mode).toBe('repair-required');
    expect(order).toEqual(['repair-window']);
  });

  it('lets normal bootstrap read canonical data without a repair prompt', async () => {
    let config = { defaultModel: 'legacy' } as Record<string, unknown>;
    const promptRepair = vi.fn();
    const canonicalReads: unknown[] = [];

    const state = await runStartupGate({
      migrate: async () => { config = { harnesses: { byId: { claude: { compatibility: { model: 'legacy' } } } } }; },
      launchNormal: () => { canonicalReads.push(config.harnesses); },
      onRepairRequired: promptRepair
    });

    expect(state).toEqual({ mode: 'ready' });
    expect(canonicalReads).toHaveLength(1);
    expect(promptRepair).not.toHaveBeenCalled();
  });
});

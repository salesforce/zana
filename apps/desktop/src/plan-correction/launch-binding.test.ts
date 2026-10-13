import { describe, expect, it, vi } from 'vitest';
import { PlanCorrectionLaunchBinding } from './launch-binding.js';
import type { PlanCorrectionService } from './service.js';

function correction() {
  const begin = vi.fn(async () => {});
  return { begin, service: { begin } as unknown as PlanCorrectionService };
}

describe('PlanCorrectionLaunchBinding', () => {
  it('binds a transient launch request to its durable execution as an interactive correction', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const { begin, service } = correction();
    binding.beginLaunch('launch-1', 'mutating work unit requires file scope');

    await expect(binding.bindExecution('launch-1', 'exec-1', service)).resolves.toBe(true);

    expect(begin).toHaveBeenCalledWith('exec-1', 'mutating work unit requires file scope', false);
  });

  it('binds each launch at most once', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const { begin, service } = correction();
    binding.beginLaunch('launch-1', 'bad');
    await binding.bindExecution('launch-1', 'exec-1', service);

    await expect(binding.bindExecution('launch-1', 'exec-2', service)).resolves.toBe(false);
    expect(begin).toHaveBeenCalledOnce();
  });

  it('ignores launches that never had a rejected plan', async () => {
    const { begin, service } = correction();
    await expect(new PlanCorrectionLaunchBinding().bindExecution('unknown', 'exec-1', service)).resolves.toBe(false);
    expect(begin).not.toHaveBeenCalled();
  });

  it('forgets a launch that failed to start so a retry cannot inherit its correction', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const { begin, service } = correction();
    binding.beginLaunch('launch-1', 'bad');
    binding.forgetLaunch('launch-1');

    await expect(binding.bindExecution('launch-1', 'exec-1', service)).resolves.toBe(false);
    expect(begin).not.toHaveBeenCalled();
  });

  it('keeps concurrent launches independent', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const { begin, service } = correction();
    binding.beginLaunch('a', 'reason a');
    binding.beginLaunch('b', 'reason b');

    await binding.bindExecution('b', 'exec-b', service);

    expect(begin).toHaveBeenCalledWith('exec-b', 'reason b', false);
    await expect(binding.bindExecution('a', 'exec-a', service)).resolves.toBe(true);
  });

  it('keeps the reason when the durable begin fails so the launch can bind on retry', async () => {
    const binding = new PlanCorrectionLaunchBinding();
    const { begin, service } = correction();
    begin.mockRejectedValueOnce(new Error('store at capacity'));
    binding.beginLaunch('launch-1', 'bad');

    await expect(binding.bindExecution('launch-1', 'exec-1', service)).rejects.toThrow('store at capacity');
    await expect(binding.bindExecution('launch-1', 'exec-1', service)).resolves.toBe(true);
    expect(begin).toHaveBeenCalledTimes(2);
  });
});

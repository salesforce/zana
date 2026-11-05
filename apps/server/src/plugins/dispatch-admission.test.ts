import { describe, expect, it, vi } from 'vitest';
import { admitMainOwnedDispatch } from './dispatch-admission.js';

const request = { projectId: 'p1', sessionId: 's1', entry: 'reply', origin: 'agent' } as const;
const ctx = (admit: ReturnType<typeof vi.fn>) => ({ db: {}, plugins: { admitDispatch: admit } }) as never;

describe('admitMainOwnedDispatch', () => {
  it('rejects when the plugin service is not available', async () => {
    await expect(admitMainOwnedDispatch(undefined, request)).resolves.toEqual({ action: 'reject', message: 'Plugin dispatch admission unavailable' });
  });

  it('proceeds and hands plugins a session-scoped pty identity with no thread id', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'proceed' });
    await expect(admitMainOwnedDispatch(ctx(admit), request)).resolves.toEqual({ action: 'proceed' });
    const arg = admit.mock.calls[0]![0];
    expect(arg).toMatchObject({ projectId: 'p1', sessionId: 's1', surface: 'pty', entry: 'reply', origin: 'agent', generation: 1 });
    expect(arg.threadId).toBeUndefined();
  });

  it('omits the session id for an initial prompt that has no session yet', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'proceed' });
    await admitMainOwnedDispatch(ctx(admit), { projectId: 'p1', entry: 'initial', origin: 'user' });
    expect('sessionId' in admit.mock.calls[0]![0]).toBe(false);
  });

  it('forwards bounded prompt text from main for core to redact and cap', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'proceed' });
    await admitMainOwnedDispatch(ctx(admit), { ...request, prompt: { text: 'hi', truncated: true } });
    expect(admit.mock.calls[0]![0].prompt).toEqual({ text: 'hi', truncated: true, attachmentCount: 0 });
  });

  it('sends no prompt key when main sent none', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'proceed' });
    await admitMainOwnedDispatch(ctx(admit), request);
    expect('prompt' in admit.mock.calls[0]![0]).toBe(false);
  });

  it('forwards a reject with its message, bounded', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'reject', message: 'x'.repeat(5000) });
    const decision = await admitMainOwnedDispatch(ctx(admit), request);
    expect(decision).toMatchObject({ action: 'reject' });
    expect((decision as { message: string }).message).toHaveLength(1024);
  });

  it('reports a wait as a wait without recording state', async () => {
    const admit = vi.fn().mockResolvedValue({ action: 'wait', reason: 'capacity', overrideable: true });
    await expect(admitMainOwnedDispatch(ctx(admit), request)).resolves.toEqual({ action: 'wait', reason: 'capacity' });
  });

  it('rejects when a plugin throws', async () => {
    const admit = vi.fn().mockRejectedValue(new Error('x'));
    await expect(admitMainOwnedDispatch(ctx(admit), request)).resolves.toMatchObject({ action: 'reject' });
  });
});

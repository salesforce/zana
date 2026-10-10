import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const h = vi.hoisted(() => ({
  handlers: new Map<string, { handler: (...args: unknown[]) => unknown; fallback: () => unknown }>(),
  config: { feedNoiseClassifierEnabled: true as boolean | undefined },
  classify: vi.fn()
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock('../native/inbox-pdf.js', () => ({ exportInboxPdf: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/suggestions/run-suggestion', () => ({ runSuggestion: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { getConfig: () => h.config } }));
vi.mock('./ctx.js', () => {
  // Any other registration-time dependency (stores, subscriptions) is an inert,
  // callable, infinitely-nested stub.
  const inert: unknown = new Proxy(() => inert, { get: () => inert, apply: () => inert });
  return { ctx: new Proxy({
    safeHandle: (channel: string, handler: (...args: unknown[]) => unknown, fallback: () => unknown) => h.handlers.set(channel, { handler, fallback }),
    feedNoiseClassifier: { classify: h.classify }
  } as Record<string, unknown>, {
    get: (target, key: string) => key in target ? target[key] : inert
  }) };
});

beforeEach(async () => {
  h.handlers.clear(); h.classify.mockReset(); h.config.feedNoiseClassifierEnabled = true;
  const { registerInboxIpc } = await import('./inbox.js');
  registerInboxIpc();
});

const classifyNoise = () => h.handlers.get(IPC.inbox.classifyNoise)!;

it('marks the unexpected-error fallback as a failed classify call', () => {
  expect(classifyNoise().fallback()).toEqual({ routineIds: [], candidateCount: 0, failed: true });
});

it('returns an empty, non-failed result when the classifier is off, and forwards when on', async () => {
  h.config.feedNoiseClassifierEnabled = false;
  await expect(classifyNoise().handler('p')).resolves.toEqual({ routineIds: [], candidateCount: 0 });
  expect(h.classify).not.toHaveBeenCalled();
  h.config.feedNoiseClassifierEnabled = true;
  h.classify.mockResolvedValue({ routineIds: ['a'], candidateCount: 1 });
  await expect(classifyNoise().handler(undefined)).resolves.toEqual({ routineIds: ['a'], candidateCount: 1 });
  expect(h.classify).toHaveBeenCalledWith(null);
});

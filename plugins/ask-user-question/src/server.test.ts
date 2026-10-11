import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { PLUGIN_INTERACTION_MAX_TIMEOUT_MS } from '@zana-ai/zcc-domain/thread-runtime';
import plugin from '../server.mjs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const questions = [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }];

async function createHost() {
  const host = createFakePluginHost({ pluginId: 'ask-user-question' });
  const defineSettings = vi.spyOn(host.zcc.settings, 'define');
  const requestInput = vi.spyOn(host.zcc.ui, 'requestInput');
  await plugin(host.zcc);
  return { host, requestInput, descriptors: defineSettings.mock.calls[0]![0] };
}

type TestHost = Awaited<ReturnType<typeof createHost>>;

/** Ask once, return the timeout the card was opened with, then dismiss the card. */
async function openedTimeoutMs({ host, requestInput }: TestHost): Promise<number | undefined> {
  requestInput.mockClear();
  const call = host.harness.callAgentTool('ask_user_question', { questions });
  await vi.waitFor(() => expect(requestInput).toHaveBeenCalledTimes(1));
  host.harness.cancelInteraction();
  await call;
  return requestInput.mock.calls[0]![0].timeoutMs;
}

describe('ask-user-question timeout setting', () => {
  it('offers 30 minutes to 7 days as a select defaulting to 30 minutes', async () => {
    const { descriptors } = await createHost();
    expect(descriptors).toEqual({
      questionTimeout: expect.objectContaining({
        type: 'select',
        label: 'Question timeout',
        options: ['30 minutes', '1 hour', '4 hours', '8 hours', '24 hours', '3 days', '7 days'],
        default: '30 minutes'
      })
    });
  });

  it('keeps the longest option within the host timeout cap', async () => {
    const test = await createHost();
    test.host.harness.setSettings({ questionTimeout: '7 days' });
    expect(await openedTimeoutMs(test)).toBe(PLUGIN_INTERACTION_MAX_TIMEOUT_MS);
  });

  it('keeps a card open for 30 minutes by default', async () => {
    expect(await openedTimeoutMs(await createHost())).toBe(30 * MINUTE);
  });

  it.each([
    ['30 minutes', 30 * MINUTE],
    ['1 hour', HOUR],
    ['4 hours', 4 * HOUR],
    ['8 hours', 8 * HOUR],
    ['24 hours', DAY],
    ['3 days', 3 * DAY],
    ['7 days', 7 * DAY]
  ])('opens the card for %s when the setting says so', async (option, expected) => {
    const test = await createHost();
    test.host.harness.setSettings({ questionTimeout: option });
    expect(await openedTimeoutMs(test)).toBe(expected);
  });

  it('applies a changed setting to the next question and leaves an open card alone', async () => {
    const test = await createHost();
    const first = test.host.harness.callAgentTool('ask_user_question', { questions });
    await vi.waitFor(() => expect(test.requestInput).toHaveBeenCalledTimes(1));
    expect(test.requestInput.mock.calls[0]![0].timeoutMs).toBe(30 * MINUTE);

    test.host.harness.setSettings({ questionTimeout: '7 days' });
    expect(test.requestInput).toHaveBeenCalledTimes(1);
    test.host.harness.cancelInteraction();
    await first;

    expect(await openedTimeoutMs(test)).toBe(7 * DAY);
  });

  it('goes back to 30 minutes when the setting is cleared', async () => {
    const test = await createHost();
    test.host.harness.setSettings({ questionTimeout: '3 days' });
    expect(await openedTimeoutMs(test)).toBe(3 * DAY);
    test.host.harness.setSettings({ questionTimeout: undefined });
    expect(await openedTimeoutMs(test)).toBe(30 * MINUTE);
  });

  it('falls back to 30 minutes for a stored value that is no longer an option', async () => {
    const test = await createHost();
    test.host.harness.setSettings({ questionTimeout: '2 weeks' });
    expect(await openedTimeoutMs(test)).toBe(30 * MINUTE);
  });

  it('still opens the card with the question payload and renderer id', async () => {
    const test = await createHost();
    const call = test.host.harness.callAgentTool('ask_user_question', { questions }, { threadId: 'thr-1' });
    await vi.waitFor(() => expect(test.requestInput).toHaveBeenCalledTimes(1));
    expect(test.requestInput).toHaveBeenCalledWith({
      threadId: 'thr-1',
      rendererId: 'ask-user-question',
      title: 'Question',
      payload: { questions },
      timeoutMs: 30 * MINUTE
    }, { signal: expect.any(AbortSignal) });
    test.host.harness.submitInteraction({ answers: ['A'] });
    await expect(call).resolves.toEqual({ outcome: 'submitted', value: { answers: ['A'] } });
  });

  it('opens an empty question card when the tool input is not an object', async () => {
    const test = await createHost();
    const call = test.host.harness.callAgentTool('ask_user_question', 'which one?');
    await vi.waitFor(() => expect(test.requestInput).toHaveBeenCalledTimes(1));
    expect(test.requestInput.mock.calls[0]![0].payload).toEqual({ questions: [] });
    test.host.harness.cancelInteraction();
    await call;
  });

  it('ties the card to the tool call so a torn-down call closes it', async () => {
    const test = await createHost();
    const execute = test.host.harness.agentTools.find((tool) => tool.name === 'ask_user_question')!.execute;
    const controller = new AbortController();
    const call = execute({ questions }, { threadId: 'thr-1', projectId: 'proj-1', signal: controller.signal });
    await vi.waitFor(() => expect(test.requestInput).toHaveBeenCalledTimes(1));
    expect(test.requestInput.mock.calls[0]![1]).toEqual({ signal: controller.signal });
    test.host.harness.cancelInteraction();
    await call;
  });

  it('hands a timeout back to the agent as the tool result', async () => {
    const test = await createHost();
    test.requestInput.mockResolvedValueOnce({ outcome: 'cancelled', reason: 'timeout' });
    await expect(test.host.harness.callAgentTool('ask_user_question', { questions })).resolves.toEqual({
      outcome: 'cancelled',
      reason: 'timeout'
    });
  });
});

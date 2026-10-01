import { afterEach, describe, expect, it, vi } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import {
  availableAgentCardActions,
  invokeAgentCardAction,
  availableThreadCardActions,
  invokeThreadCardAction,
  invokeAgentsBoardAction
} from './plugin-agent-actions.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

afterEach(() => {
  clearPluginSlots('hello');
  vi.restoreAllMocks();
});

describe('plugin agent actions', () => {
  it('hides card actions when isAvailable is false and skips a throwing gate', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_agentCardAction({
          id: 'ok',
          title: 'Ok',
          run: () => undefined
        });
        app.slots.experimental_agentCardAction({
          id: 'gated',
          title: 'Gated',
          isAvailable: () => true,
          run: () => undefined
        });
        app.slots.experimental_agentCardAction({
          id: 'hidden',
          title: 'Hidden',
          isAvailable: () => false,
          run: () => undefined
        });
        app.slots.experimental_agentCardAction({
          id: 'boom',
          title: 'Boom',
          isAvailable: () => {
            throw new Error('gate failed');
          },
          run: () => undefined
        });
      })
    );
    const visible = availableAgentCardActions(set.agentCardActions, { sessionId: 's1', projectId: 'p1' });
    expect(visible.map((row) => row.id)).toEqual(['ok', 'gated']);
    expect(warn).toHaveBeenCalled();
  });

  it('invokes card and board runs and swallows thrown errors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cardRun = vi.fn();
    const boardRun = vi.fn(() => {
      throw new Error('board failed');
    });
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_agentCardAction({
          id: 'card',
          title: 'Card',
          run: cardRun
        });
        app.slots.experimental_agentsBoardAction({
          id: 'board',
          title: 'Board',
          run: boardRun
        });
      })
    );
    invokeAgentCardAction(set.agentCardActions[0]!, { sessionId: 's1', projectId: 'p1' });
    invokeAgentsBoardAction(set.agentsBoardActions[0]!, { projectId: null });
    expect(cardRun).toHaveBeenCalledWith({ sessionId: 's1', projectId: 'p1' });
    expect(boardRun).toHaveBeenCalledWith({ projectId: null });
    expect(warn).toHaveBeenCalled();
  });

  it('catches rejected card runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_agentCardAction({
          id: 'async',
          title: 'Async',
          run: () => Promise.reject(new Error('nope'))
        });
      })
    );
    invokeAgentCardAction(set.agentCardActions[0]!, { sessionId: 's1', projectId: 'p1' });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it('stringifies non-Error throws from board actions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_agentsBoardAction({
          id: 'board',
          title: 'Board',
          run: () => {
            throw 'nope';
          }
        });
      })
    );
    invokeAgentsBoardAction(set.agentsBoardActions[0]!, { projectId: 'p1' });
    expect(warn.mock.calls[0]?.[0]).toContain('nope');
  });

  it('uses host-derived Modern thread context and isolates plugin failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const run = vi.fn(() => Promise.reject(new Error('nope')));
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_threadCardAction({
          id: 'thread',
          title: 'Thread',
          isAvailable: ({ threadId, projectId }) => threadId === 't1' && projectId === 'p1',
          run
        });
      })
    );
    const context = { threadId: 't1', projectId: 'p1' };
    const visible = availableThreadCardActions(set.threadCardActions, context);
    expect(visible).toHaveLength(1);
    invokeThreadCardAction(visible[0]!, context);
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(context);
    expect(warn).toHaveBeenCalled();
  });

  it('passes null project context for threads outside a registered project', () => {
    const run = vi.fn();
    const set = interpretPluginApp(
      'hello',
      definePluginApp((app) => {
        app.slots.experimental_threadCardAction({ id: 'thread', title: 'Thread', run });
      })
    );
    const context = { threadId: 't1', projectId: null };
    invokeThreadCardAction(set.threadCardActions[0]!, context);
    expect(run).toHaveBeenCalledWith(context);
  });
});

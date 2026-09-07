import { describe, expect, it } from 'vitest';
import { queueAgentScriptOpen, takeQueuedAgentScriptOpen } from './agent-script-open.js';
import {
  AGENTFORCE_PLAYGROUND_ACTION,
  AGENTFORCE_PREVIEW_ACTION,
  agentforcePanelParams,
  openAgentforcePlayground,
  openAgentforcePreview,
  parseAgentforcePanelApiName,
  parseAgentforcePanelPath
} from './agentforce-panel-params.js';

describe('agentforce panel params', () => {
  it('reads path and apiName from thread-panel params', () => {
    expect(parseAgentforcePanelPath({ path: ' force-app/Bot.agent ' })).toBe('force-app/Bot.agent');
    expect(parseAgentforcePanelApiName({ apiName: ' MyBot ' })).toBe('MyBot');
    expect(parseAgentforcePanelPath(null)).toBeUndefined();
    expect(parseAgentforcePanelApiName('nope')).toBeUndefined();
    expect(agentforcePanelParams('a.agent', 'A')).toEqual({ path: 'a.agent', apiName: 'A' });
    expect(agentforcePanelParams()).toEqual({});
  });

  it('opens Playground as a thread side panel and queues the file', () => {
    const calls: unknown[] = [];
    expect(
      openAgentforcePlayground({
        openThreadPanel: (options) => {
          calls.push(options);
          return true;
        },
        projectId: 'proj-1',
        path: 'force-app/Bot.agent'
      })
    ).toBe(true);
    expect(calls).toEqual([
      {
        actionId: AGENTFORCE_PLAYGROUND_ACTION,
        title: 'Playground',
        params: { path: 'force-app/Bot.agent' }
      }
    ]);
    expect(takeQueuedAgentScriptOpen('proj-1')).toBe('force-app/Bot.agent');
  });

  it('opens Preview as a thread side panel without a queue', () => {
    queueAgentScriptOpen('proj-1', 'stale.agent');
    const calls: unknown[] = [];
    expect(
      openAgentforcePreview({
        openThreadPanel: (options) => {
          calls.push(options);
          return true;
        },
        path: 'force-app/Bot.agent',
        apiName: 'Bot'
      })
    ).toBe(true);
    expect(calls).toEqual([
      {
        actionId: AGENTFORCE_PREVIEW_ACTION,
        title: 'Preview',
        params: { path: 'force-app/Bot.agent', apiName: 'Bot' }
      }
    ]);
    expect(takeQueuedAgentScriptOpen('proj-1')).toBe('stale.agent');
  });
});

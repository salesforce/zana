import { describe, expect, it } from 'vitest';
import { queueAgentScriptOpen, takeQueuedAgentScriptOpen } from './agent-script-open.js';
import {
  AGENTFORCE_AGENT_ACTION,
  agentforceAgentParams,
  isAgentPanelPath,
  parseAgentforceAgentParams,
  AGENTFORCE_PREVIEW_ACTION,
  agentforcePanelParams,
  openAgentforcePreview,
  parseAgentforcePanelApiName,
  parseAgentforcePanelFocus,
  parseAgentforcePanelPath,
  parseAgentforcePanelRun
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
  it('reads a simulation batch from a card link', () => {
    const params = agentforcePanelParams('a.agent', undefined, { tool: 'test', simulation: 'b-1' });
    expect(params).toEqual({ path: 'a.agent', tool: 'test', simulation: 'b-1' });
    expect(parseAgentforcePanelFocus(params)).toEqual({ path: 'a.agent', tool: 'test', simulation: 'b-1' });
    for (const simulation of ['../x', '', 7, 'x'.repeat(65)]) expect(parseAgentforcePanelFocus({ simulation }).simulation).toBeUndefined();
  });
  it('reads a linked run and its 1-based turn from string or number params', () => {
    expect(parseAgentforcePanelRun({ runId: ' r1 ', turn: '3' })).toEqual({ runId: 'r1', turn: 3 });
    expect(parseAgentforcePanelRun({ runId: 'r1', turn: 2 })).toEqual({ runId: 'r1', turn: 2 });
    for (const turn of [0, '0', 'x', '12345', 1.5, null]) expect(parseAgentforcePanelRun({ runId: 'r1', turn })).toEqual({ runId: 'r1' });
    for (const params of [null, [], 'r1', {}, { runId: '' }, { runId: 'x'.repeat(257) }, { runId: 7 }]) expect(parseAgentforcePanelRun(params)).toBeNull();
  });

  it('builds and reads the Agent panel params', () => {
    expect(AGENTFORCE_AGENT_ACTION).toBe('agent');
    const params = agentforceAgentParams({ path: 'force-app/Bot.agent', view: 'preview', line: 7, runId: 'r1', turn: 2, node: 'main', projectId: 'p1', sub: 'simulations', batchId: 'b-1' });
    expect(params).toEqual({ path: 'force-app/Bot.agent', view: 'preview', line: '7', runId: 'r1', turn: '2', node: 'main', projectId: 'p1', sub: 'simulations', batchId: 'b-1' });
    expect(parseAgentforceAgentParams(params)).toEqual({ path: 'force-app/Bot.agent', view: 'preview', line: 7, runId: 'r1', turn: 2, node: 'main', projectId: 'p1', sub: 'simulations', batchId: 'b-1' });
    expect(agentforceAgentParams({ path: 'a.agent' })).toEqual({ path: 'a.agent', view: 'file' });
    expect(agentforceAgentParams({ path: 'a.agent', view: 'nope' as never, line: 0, turn: 0, batchId: '../x', runId: ' ' })).toEqual({ path: 'a.agent', view: 'file' });
  });
  it('requires a safe agent path', () => {
    for (const path of ['', 'a.txt', '../a.agent', 'x/../a.agent', 'a\\..\\b.agent', 'a\0.agent', `${'x'.repeat(500)}.agent`]) {
      expect(isAgentPanelPath(path)).toBe(false);
      expect(agentforceAgentParams({ path })).toBeNull();
    }
    expect(isAgentPanelPath('x/A.AFSCRIPT')).toBe(true);
    for (const params of [null, [], 'x', {}, { path: 7 }, { path: 'a.txt' }]) expect(parseAgentforceAgentParams(params)).toBeNull();
    expect(parseAgentforceAgentParams({ path: ' a.agent ', view: 'bogus', line: '12', turn: 3, runId: 9, batchId: 'bad id' })).toEqual({ path: 'a.agent', view: 'file', line: 12, turn: 3 });
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

/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { takeQueuedAgentScriptOpen } from '../agent-script-open.js';
import { findStudioIntentTarget, registerStudioIntentTarget, routeStudioIntent, type StudioIntent, type StudioIntentTarget } from './studio-intents.js';

const openInStudioWindow = vi.hoisted(() => vi.fn(async () => false));
vi.mock('../studio-window-route.js', () => ({ STUDIO_TAB_ID: 'salesforce', openInStudioWindow }));

const PATH = 'force-app/main/default/aiAuthoringBundles/Bot/Bot.agent';
const unregister: Array<() => void> = [];

function target(projectId: string, root: HTMLElement, handle: StudioIntentTarget['handle'] = () => true) {
  const entry = { projectId, root, handle: vi.fn(handle) };
  unregister.push(registerStudioIntentTarget(entry));
  return entry;
}
const el = (parent: Element = document.body, tag = 'div') => parent.appendChild(document.createElement(tag));
function navigateMock(threadOpens = true) {
  return { openThreadPanel: vi.fn(() => threadOpens), toProject: vi.fn(), openInWindow: vi.fn(async () => true) } as never as Parameters<typeof routeStudioIntent>[0]['navigate'] & { openThreadPanel: ReturnType<typeof vi.fn>; toProject: ReturnType<typeof vi.fn> };
}
const route = (intent: StudioIntent, navigate: ReturnType<typeof navigateMock>, over: Partial<Parameters<typeof routeStudioIntent>[0]> = {}) =>
  routeStudioIntent({ pluginId: 'salesforce', projectId: 'p1', threadId: 't1', intent, from: null, navigate, ...over });

beforeEach(() => { openInStudioWindow.mockReset(); openInStudioWindow.mockResolvedValue(false); });
afterEach(() => { for (const off of unregister.splice(0)) off(); document.body.innerHTML = ''; takeQueuedAgentScriptOpen('p1'); });

describe('findStudioIntentTarget', () => {
  it('finds the Studio whose root contains the click', () => {
    const root = el();
    const found = target('p1', root);
    expect(findStudioIntentTarget('p1', el(root))).toBe(found);
  });

  it('finds the Studio beside the click in the same host page layout', () => {
    const layout = el();
    layout.setAttribute('data-testid', 'plugin-panel-host-layout');
    const found = target('p1', el(layout));
    expect(findStudioIntentTarget('p1', el(el(layout)))).toBe(found);
  });

  it('ignores another project, a Studio in another layout, an unrelated click and missing input', () => {
    const layout = el();
    layout.setAttribute('data-testid', 'plugin-panel-host-layout');
    const otherLayout = el();
    otherLayout.setAttribute('data-testid', 'plugin-panel-host-layout');
    const root = el(layout);
    target('p2', root);
    expect(findStudioIntentTarget('p1', el(root))).toBeNull();
    target('p1', el(otherLayout));
    expect(findStudioIntentTarget('p1', el(layout))).toBeNull();
    expect(findStudioIntentTarget('p1', el())).toBeNull();
    expect(findStudioIntentTarget(null, root)).toBeNull();
    expect(findStudioIntentTarget('p1', null)).toBeNull();
  });

  it('forgets an unregistered Studio', () => {
    const root = el();
    const off = registerStudioIntentTarget({ projectId: 'p1', root, handle: () => true });
    expect(findStudioIntentTarget('p1', root)).not.toBeNull();
    off();
    expect(findStudioIntentTarget('p1', root)).toBeNull();
  });
});

describe('routeStudioIntent', () => {
  it('lets the Studio beside the click take the intent', async () => {
    const root = el();
    const studio = target('p1', root);
    const navigate = navigateMock();
    const intent: StudioIntent = { kind: 'graph', path: PATH, node: 'main' };
    expect(await route(intent, navigate, { from: el(root) })).toBe('studio');
    expect(studio.handle).toHaveBeenCalledWith(intent);
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
  });

  it('falls through when the Studio declines or throws', async () => {
    const root = el();
    target('p1', root, () => false);
    const navigate = navigateMock();
    expect(await route({ kind: 'agent', path: PATH }, navigate, { from: el(root) })).toBe('thread');
    target('p1', root, () => { throw new Error('boom'); });
    expect(await route({ kind: 'agent', path: PATH }, navigate, { from: el(root) })).toBe('thread');
  });

  it('opens the thread Agent panel with validated params', async () => {
    const navigate = navigateMock();
    expect(await route({ kind: 'agent', path: PATH, line: 12 }, navigate)).toBe('thread');
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith({ actionId: 'agent', title: 'Bot', params: { path: PATH, view: 'file', line: '12', projectId: 'p1' }, threadId: 't1' });
    await route({ kind: 'tests', path: PATH, sub: 'simulations', batchId: 'b1' }, navigate);
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ view: 'tests', sub: 'simulations', batchId: 'b1' }) }));
    await route({ kind: 'graph', path: PATH, node: 'main' }, navigate);
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ view: 'graph', node: 'main' }) }));
    await route({ kind: 'preview', path: PATH, runId: 'r1', turn: 2 }, navigate);
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ view: 'preview', runId: 'r1', turn: '2' }) }));
    for (const kind of ['actions', 'comments'] as const) {
      await route({ kind, path: PATH }, navigate);
      expect(navigate.openThreadPanel).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ view: kind }) }));
    }
  });

  it('lets the host resolve the owner when no thread id is known', async () => {
    const navigate = navigateMock();
    await route({ kind: 'agent', path: PATH }, navigate, { threadId: null });
    expect(navigate.openThreadPanel.mock.calls[0]![0]).not.toHaveProperty('threadId');
  });

  it('opens a preview run without a path in the Preview panel', async () => {
    const navigate = navigateMock();
    expect(await route({ kind: 'preview', runId: 'r1', turn: 3 }, navigate)).toBe('thread');
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: 'preview', title: 'Preview', params: { runId: 'r1', turn: '3' }, threadId: 't1' });
    await route({ kind: 'preview', runId: 'r1' }, navigate);
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith({ actionId: 'preview', title: 'Preview', params: { runId: 'r1' }, threadId: 't1' });
  });

  it('opens the Studio project tab for intents without a thread view', async () => {
    const navigate = navigateMock();
    expect(await route({ kind: 'org-preview' }, navigate)).toBe('project-tab');
    expect(await route({ kind: 'preview' }, navigate)).toBe('project-tab');
    expect(await route({ kind: 'tests' }, navigate)).toBe('project-tab');
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
    expect(navigate.toProject).toHaveBeenCalledWith('p1', { tabId: 'salesforce' });
    expect(openInStudioWindow).not.toHaveBeenCalled();
  });

  it('falls back to the Studio window when no thread can hold the panel', async () => {
    openInStudioWindow.mockResolvedValue(true);
    const navigate = navigateMock(false);
    expect(await route({ kind: 'agent', path: PATH, line: 4 }, navigate)).toBe('studio-window');
    expect(openInStudioWindow).toHaveBeenCalledWith({ pluginId: 'salesforce', projectId: 'p1', path: PATH, line: 4, navigate });
    expect(navigate.toProject).not.toHaveBeenCalled();
    expect(takeQueuedAgentScriptOpen('p1')).toBeNull();
  });

  it('falls back to the project tab and queues the agent when no window runs', async () => {
    const navigate = navigateMock(false);
    expect(await route({ kind: 'graph', path: PATH }, navigate)).toBe('project-tab');
    expect(openInStudioWindow).toHaveBeenCalledWith(expect.not.objectContaining({ line: expect.anything() }));
    expect(navigate.toProject).toHaveBeenCalledWith('p1', { tabId: 'salesforce' });
    expect(takeQueuedAgentScriptOpen('p1')).toBe(PATH);
  });

  it('skips the thread panel for a path that is not an agent file, and refuses without a project', async () => {
    const navigate = navigateMock();
    expect(await route({ kind: 'agent', path: '../x.txt' }, navigate)).toBe('project-tab');
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
    expect(await route({ kind: 'agent', path: PATH }, navigate, { projectId: null, threadId: null })).toBe('thread');
    const none = navigateMock(false);
    expect(await route({ kind: 'agent', path: PATH }, none, { projectId: null })).toBe(false);
    expect(none.toProject).not.toHaveBeenCalled();
  });
});

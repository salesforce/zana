/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFileOpener } from './AgentFileOpener.js';
import { openAgentInStudioWindow } from './studio-window-route.js';

vi.mock('./studio-window-route.js', () => ({ STUDIO_TAB_ID: 'salesforce', openAgentInStudioWindow: vi.fn(async () => true), openInStudioWindow: vi.fn(async () => false) }));
vi.mock('./ActionCodePreview.js', () => ({ ActionCodePreview: (p: any) => <div data-testid="editor" data-language={p.language} data-line={String(p.line)}>{p.content}</div> }));

const PATH = 'force-app/main/default/aiAuthoringBundles/GuiAgentReview/GuiAgentReview.agent';
const Original = () => <pre data-testid="original">system:</pre>;

type Source = { kind?: string; threadId: string | null; projectId: string | null };
let read: (args: unknown) => Promise<unknown>;

function mount(options: { threadId?: string | null; source?: Source; opened?: boolean; projectId?: string | null; surface?: string; windows?: boolean; lineNumber?: number }) {
  const openThreadPanel = vi.fn(() => options.opened ?? true);
  const toProject = vi.fn();
  const navigate = { openThreadPanel, toProject, ...(options.windows === false ? {} : { openInWindow: vi.fn(async () => true) }) };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => navigate,
    useZccContext: () => ({ projectId: options.projectId === undefined ? 'proj-1' : options.projectId, threadId: options.threadId ?? null, surface: options.surface ?? 'main' })
  };
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: vi.fn((_plugin: string, _method: string, args: unknown) => read(args)) };
  render(<AgentFileOpener pluginId="salesforce" path={PATH} source={options.source} lineNumber={options.lineNumber} experimental_Original={Original} />);
  return Object.assign(openThreadPanel, { toProject });
}

beforeEach(() => { read = async () => ({ ok: false }); });

afterEach(() => {
  cleanup();
  delete (globalThis as any).__ZCC_PLUGIN_HOST__;
  vi.mocked(openAgentInStudioWindow).mockClear();
  delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__;
});

describe('AgentFileOpener', () => {
  it('shows the file name, falls back to the host preview and enables both actions without a route thread', async () => {
    mount({});
    expect(screen.getByText('GuiAgentReview.agent')).toBeTruthy();
    expect(await screen.findByTestId('original')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Open agent view' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens the Agent panel file view for an agent session, letting the host resolve the owner', () => {
    const openThreadPanel = mount({ source: { threadId: null, projectId: 'proj-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open agent view' }));
    expect(openThreadPanel).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'agent', title: 'GuiAgentReview', params: expect.objectContaining({ path: PATH, view: 'file' }) }));
    expect(openThreadPanel.mock.calls[0]?.[0]).not.toHaveProperty('threadId');
  });

  it('passes the preview tab thread as the owner hint for Preview', () => {
    const openThreadPanel = mount({ source: { threadId: 'thread-9', projectId: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(openThreadPanel).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'agent', params: expect.objectContaining({ view: 'preview' }), threadId: 'thread-9' }));
  });

  it('prefers the route thread over the preview source', () => {
    const openThreadPanel = mount({ threadId: 'route-thread', source: { threadId: 'thread-9', projectId: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Open agent view' }));
    expect(openThreadPanel).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'route-thread' }));
  });

  it('opens the Studio when the host has no conversation to hold the panel', async () => {
    const openThreadPanel = mount({ opened: false });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(openThreadPanel.toProject).toHaveBeenCalledWith('proj-1', { tabId: 'salesforce' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains only when there is neither a conversation nor a project', async () => {
    mount({ opened: false, projectId: null });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect((await screen.findByRole('status')).textContent).toContain('from a project');
  });

  it('opens the agent in the Studio window and reports a window that never takes it', async () => {
    mount({});
    const button = screen.getByRole('button', { name: 'Open in Studio window' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(openAgentInStudioWindow).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'salesforce', projectId: 'proj-1', path: PATH }));
    expect(screen.queryByRole('status')).toBeNull();
    vi.mocked(openAgentInStudioWindow).mockResolvedValueOnce(false);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Studio window did not open'));
  });

  it('uses the preview source project when the route has none', async () => {
    mount({ projectId: null, source: { threadId: null, projectId: 'proj-src' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open in Studio window' }));
    await waitFor(() => expect(openAgentInStudioWindow).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-src' })));
  });

  it('hides the window button without a project, without host windows, or inside the Studio window', () => {
    for (const options of [{ projectId: null }, { windows: false }, { surface: 'plugin-view' }]) {
      mount(options);
      expect(screen.queryByRole('button', { name: 'Open in Studio window' })).toBeNull();
      cleanup();
    }
  });

  it('shows the project file in the Agent Script editor at the requested line', async () => {
    const calls: unknown[] = [];
    read = async args => { calls.push(args); return { ok: true, file: { path: PATH, content: 'system:\n  instructions: hi', sha256: 'x' } }; };
    mount({ lineNumber: 7 });
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    const editor = await screen.findByTestId('editor');
    expect(editor.dataset.language).toBe('agentscript');
    expect(editor.dataset.line).toBe('7');
    expect(editor.textContent).toContain('instructions: hi');
    expect(screen.queryByTestId('original')).toBeNull();
    expect(calls).toEqual([{ projectId: 'proj-1', path: PATH }]);
  });

  it('keeps the host preview for thread storage, without a project, or when the read fails', async () => {
    const calls: unknown[] = [];
    read = async args => { calls.push(args); return { ok: true, file: { path: PATH, content: 'x' } }; };
    mount({ source: { kind: 'thread-storage', threadId: 't', projectId: 'proj-1' } });
    expect(await screen.findByTestId('original')).toBeTruthy();
    cleanup();
    mount({ projectId: null });
    expect(await screen.findByTestId('original')).toBeTruthy();
    expect(calls).toEqual([]);
    cleanup();
    read = async () => { throw new Error('offline'); };
    mount({});
    expect(await screen.findByTestId('original')).toBeTruthy();
    cleanup();
    read = async () => ({ ok: true, file: {} });
    mount({});
    expect(await screen.findByTestId('original')).toBeTruthy();
  });

  it('ignores a read that settles after the opener unmounts', async () => {
    let settle!: (value: unknown) => void;
    read = () => new Promise(resolve => { settle = resolve; });
    mount({});
    cleanup();
    settle({ ok: true, file: { content: 'late' } });
    await Promise.resolve();
    expect(screen.queryByTestId('editor')).toBeNull();
  });
});

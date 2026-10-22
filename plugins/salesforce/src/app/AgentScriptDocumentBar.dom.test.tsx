/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AgentScriptDocumentBar } from './AgentScriptDocumentBar.js';

afterEach(cleanup);
const defaults = {
  path: 'force-app/main/default/aiAuthoringBundles/Support/Support.agent', dirty: false, busy: false,
  issues: 0, saveDisabled: false, saveAsDisabled: false, panelOpen: true,
  onBrowse: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn(), onShowPanel: vi.fn()
};

describe('Agent Script document toolbar', () => {
  it('gives the filename priority, retains the full path and shows one saved status', () => {
    render(<AgentScriptDocumentBar {...defaults} />);
    const file = screen.getByLabelText('Agentforce file');
    expect(file.title).toBe(defaults.path);
    expect(file.querySelector('.af-document-name')?.textContent).toBe('Support.agent');
    expect(file.querySelector('.af-document-folder')?.textContent).toBe('force-app / main / default / aiAuthoringBundles / Support');
    expect(screen.getByRole('status').textContent).toBe('Saved');
    expect(screen.getAllByText('Saved')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save Agentforce file' }).textContent).toBe('Save');
    expect(file.querySelector('.af-document-issues')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show side panel' })).toBeNull();
  });

  it.each([['Win32', 'Ctrl+P', 'Ctrl+S'], ['MacIntel', '⌘P', '⌘S']])('labels Go to file and Save shortcuts for %s', (platform, find, save) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    render(<AgentScriptDocumentBar {...defaults} onQuickOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Go to file' }).title).toBe(`Go to file (${find})`);
    expect(screen.getByRole('button', { name: 'Save Agentforce file' }).title).toBe(`Save Agentforce file (${save})`);
    vi.restoreAllMocks();
  });

  it('keeps toolbar actions and a labelled org picker usable', () => {
    const onBrowse = vi.fn(), onSave = vi.fn(), onSaveAs = vi.fn(), onShowPanel = vi.fn();
    render(<AgentScriptDocumentBar {...defaults} panelOpen={false} dirty issues={1}
      orgPicker={<select aria-label="Salesforce org"><option>development (sandbox)</option></select>}
      headerActions={<button>Open beside agent</button>} {...{ onBrowse, onSave, onSaveAs, onShowPanel }} />);
    expect(screen.getByRole('status').textContent).toBe('Unsaved draft');
    expect(screen.getByText('1 issue')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Agentforce file' }).className).toContain('is-dirty');
    expect(screen.getByRole('combobox', { name: 'Salesforce org' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open beside agent' })).toBeTruthy();
    for (const name of ['Browse org agents', 'Save Agentforce file', 'Show side panel']) fireEvent.click(screen.getByRole('button', { name }));
    // Save as… sits under Save's arrow; choosing it closes the menu.
    const more = screen.getByRole('button', { name: 'More save options' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.className).toContain('is-dirty');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Save as…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as…' }));
    expect(screen.queryByRole('menu')).toBeNull();
    for (const callback of [onBrowse, onSave, onSaveAs, onShowPanel]) expect(callback).toHaveBeenCalledOnce();
  });

  it('shows saving and disabled actions without treating the draft as saved', () => {
    render(<AgentScriptDocumentBar {...defaults} busy dirty issues={3} saveDisabled saveAsDisabled />);
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    expect(screen.getByText('3 issues')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save Agentforce file' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toBe('Saving…');
    expect(save.className).not.toContain('is-dirty');
    expect((screen.getByRole('button', { name: 'More save options' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('closes the Save menu on Escape, an outside click, or when Save as… becomes unavailable', () => {
    const view = render(<AgentScriptDocumentBar {...defaults} />);
    const more = screen.getByRole('button', { name: 'More save options' });
    fireEvent.keyDown(more, { key: 'Escape' });
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Enter' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.pointerDown(screen.getByRole('menuitem'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(more);
    view.rerender(<AgentScriptDocumentBar {...defaults} saveAsDisabled />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps Save as… under Save\'s arrow, offers no Publish, and shrinks Compile to an icon', () => {
    const onCompile = vi.fn();
    const view = render(<AgentScriptDocumentBar {...defaults} dirty onCompile={onCompile} />);
    const more = () => screen.getByRole('button', { name: 'More save options' });
    expect(screen.getByRole('button', { name: 'Save Agentforce file' }).className).toContain('is-dirty');
    expect((screen.getByRole('button', { name: 'Compile' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(more());
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Save as…']);
    expect(screen.queryByTestId('salesforce-agent-script-publish')).toBeNull();
    fireEvent.click(more());
    view.rerender(<AgentScriptDocumentBar {...defaults} onCompile={onCompile} />);
    expect(screen.getByRole('button', { name: 'Save Agentforce file' }).className).not.toContain('is-dirty');
    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));
    expect(onCompile).toHaveBeenCalledOnce();
    view.rerender(<AgentScriptDocumentBar {...defaults} compiling onCompile={onCompile} />);
    expect(screen.getByRole('button', { name: 'Compiling…' }).className).toContain('is-busy');
    // A new draft has no file yet: Save as… stands alone and is the filled action.
    view.rerender(<AgentScriptDocumentBar {...defaults} path={null} dirty />);
    expect(screen.getByRole('button', { name: 'Save as…' }).className).toContain('is-dirty');
  });

  it('labels the no-file state and untitled drafts, hides file save and omits an empty folder path', () => {
    const view = render(<AgentScriptDocumentBar {...defaults} path={null} />);
    expect(screen.getByLabelText('Agentforce file').title).toBe('No agent open');
    expect(screen.getByRole('status').textContent).toBe('Open or create an agent');
    expect(screen.queryByRole('button', { name: 'Save Agentforce file' })).toBeNull();
    expect(view.container.querySelector('.af-document-folder')).toBeNull();
    expect(view.container.querySelector('.af-document-org')).toBeNull();
    view.rerender(<AgentScriptDocumentBar {...defaults} path={null} dirty />);
    expect(within(screen.getByLabelText('Agentforce file')).getByText('No agent open')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Unsaved draft');
    view.rerender(<AgentScriptDocumentBar {...defaults} path="Support.agent" />);
    expect(view.container.querySelector('.af-document-folder')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('opens Preview for saved and unsaved agents, and disables it until a file is open', () => {
    const onPreview = vi.fn();
    const view = render(<AgentScriptDocumentBar {...defaults} onPreview={onPreview} />);
    const preview = () => screen.getByRole('button', { name: 'Preview', exact: true }) as HTMLButtonElement;
    expect(preview().textContent).toBe('Preview');
    fireEvent.click(preview());
    view.rerender(<AgentScriptDocumentBar {...defaults} dirty onPreview={onPreview} />);
    expect(preview().disabled).toBe(false);
    fireEvent.click(preview());
    expect(onPreview).toHaveBeenCalledTimes(2);
    view.rerender(<AgentScriptDocumentBar {...defaults} path={null} onPreview={onPreview} />);
    expect(preview().disabled).toBe(true);
    fireEvent.click(preview());
    expect(onPreview).toHaveBeenCalledTimes(2);
    view.rerender(<AgentScriptDocumentBar {...defaults} />);
    expect(screen.queryByRole('button', { name: 'Preview', exact: true })).toBeNull();
  });

  it('fetches the saved agent from the org, but not with unsaved edits', () => {
    const onFetch = vi.fn();
    const { rerender } = render(<AgentScriptDocumentBar {...defaults} onFetch={onFetch} />);
    const fetch = () => screen.getByRole('button', { name: 'Fetch agent from org' }) as HTMLButtonElement;
    expect(fetch().title).toBe('Fetch this agent and what it uses from the org');
    fireEvent.click(fetch());
    expect(onFetch).toHaveBeenCalledOnce();
    rerender(<AgentScriptDocumentBar {...defaults} dirty onFetch={onFetch} />);
    expect(fetch().disabled).toBe(true);
    expect(fetch().title).toMatch(/^Save first/);
    rerender(<AgentScriptDocumentBar {...defaults} />);
    expect(screen.queryByRole('button', { name: 'Fetch agent from org' })).toBeNull();
  });

  it('opens the saved agent in Agentforce Builder, but not an unsaved one or while opening', () => {
    const onOpenInBuilder = vi.fn();
    const { rerender } = render(<AgentScriptDocumentBar {...defaults} onOpenInBuilder={onOpenInBuilder} />);
    const open = () => screen.getByRole('button', { name: 'Open in Agentforce Builder' }) as HTMLButtonElement;
    expect(open().title).toBe('Open in Agentforce Builder (Chrome)');
    fireEvent.click(open());
    expect(onOpenInBuilder).toHaveBeenCalledOnce();
    rerender(<AgentScriptDocumentBar {...defaults} onOpenInBuilder={onOpenInBuilder} openingBuilder />);
    expect(open().disabled).toBe(true);
    expect(open().className).toContain('is-busy');
    rerender(<AgentScriptDocumentBar {...defaults} path={null} onOpenInBuilder={onOpenInBuilder} />);
    expect(open().disabled).toBe(true);
  });
});

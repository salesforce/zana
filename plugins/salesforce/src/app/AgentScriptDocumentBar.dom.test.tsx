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
    for (const name of ['Browse org agents', 'Save Agentforce file', 'Save as…', 'Show side panel']) fireEvent.click(screen.getByRole('button', { name }));
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
    expect((screen.getByRole('button', { name: 'Save as…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('labels examples and untitled drafts, hides file save and omits an empty folder path', () => {
    const view = render(<AgentScriptDocumentBar {...defaults} path={null} exampleTitle="Support concierge" />);
    expect(screen.getByLabelText('Agentforce file').title).toBe('Support concierge');
    expect(screen.getByRole('status').textContent).toBe('Example');
    expect(screen.queryByRole('button', { name: 'Save Agentforce file' })).toBeNull();
    expect(view.container.querySelector('.af-document-folder')).toBeNull();
    expect(view.container.querySelector('.af-document-org')).toBeNull();
    view.rerender(<AgentScriptDocumentBar {...defaults} path={null} dirty />);
    expect(within(screen.getByLabelText('Agentforce file')).getByText('Untitled')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Unsaved draft');
    view.rerender(<AgentScriptDocumentBar {...defaults} path="Support.agent" />);
    expect(view.container.querySelector('.af-document-folder')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });
});

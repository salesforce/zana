/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SalesforceUiProvider } from './components/client.js';
import { SalesforceOrgsPanel } from './SalesforceOrgsPanel.js';
import { takeQueuedAgentScriptOpen } from './agent-script-open.js';
import { readProjectView } from './project-view.js';
import { recordRecentAgent } from './recent-agents.js';

vi.mock('./OrgPicker.js', () => ({ OrgPicker: () => <div data-testid="org-picker" /> }));

const projects = [
  { id: 'sf', name: 'Agents', salesforce: true, dxProject: true, targetAlias: 'dev' },
  { id: 'draft', name: 'Drafts', salesforce: true, dxProject: false, targetAlias: null },
  { id: 'notes', name: 'Notes', salesforce: false, dxProject: false, targetAlias: null },
];
const call = vi.fn();
let navigate: { toProject: ReturnType<typeof vi.fn>; openInWindow?: ReturnType<typeof vi.fn> };

beforeEach(() => {
  localStorage.clear();
  call.mockReset();
  call.mockImplementation(async (method: string) => method === 'hub.projects' ? { ok: true, projects } : { ok: true });
  navigate = { toProject: vi.fn(), openInWindow: vi.fn(async () => true) };
  Object.assign(globalThis, { __ZCC_PLUGIN_RUNTIME__: { useZccNavigate: () => navigate } });
});
afterEach(() => {
  cleanup();
  delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__;
});
const mount = () => render(<SalesforceUiProvider client={{ call }}><SalesforceOrgsPanel pluginId="salesforce" /></SalesforceUiProvider>);

describe('Salesforce hub', () => {
  it('opens the Studio in the chosen project and keeps the org manager', async () => {
    mount();
    const select = await screen.findByRole('combobox', { name: 'Project' }) as HTMLSelectElement;
    expect(select.value).toBe('sf');
    expect([...select.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['Salesforce projects', 'Other projects']);
    expect(screen.getByTestId('salesforce-hub-target').textContent).toBe('Target dev');
    expect(screen.getByTestId('org-picker')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Studio' }));
    expect(readProjectView('sf')).toBe('agentforce');
    expect(navigate.toProject).toHaveBeenCalledWith('sf', { tabId: 'salesforce' });

    fireEvent.change(select, { target: { value: 'draft' } });
    expect(screen.getByTestId('salesforce-hub-target').textContent).toBe('Uses the shared default org · drafts only, no DX project');
    expect(localStorage.getItem('salesforce:hub:project')).toBe('draft');
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    expect(readProjectView('draft')).toBe('data');
    expect(navigate.toProject).toHaveBeenLastCalledWith('draft', { tabId: 'salesforce' });
  });

  it('restores the remembered project and falls back when it is gone', async () => {
    localStorage.setItem('salesforce:hub:project', 'notes');
    mount();
    expect(((await screen.findByRole('combobox', { name: 'Project' })) as HTMLSelectElement).value).toBe('notes');
    cleanup();
    localStorage.setItem('salesforce:hub:project', 'removed');
    mount();
    expect(((await screen.findByRole('combobox', { name: 'Project' })) as HTMLSelectElement).value).toBe('sf');
  });

  it('opens the Studio window on Agentforce and explains when it cannot', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open in own window' }));
    await waitFor(() => expect(navigate.openInWindow).toHaveBeenCalledWith('sf', { tabId: 'salesforce' }));
    expect(readProjectView('sf', true)).toBe('agentforce');
    expect(screen.queryByRole('status')).toBeNull();

    navigate.openInWindow!.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open in own window' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/desktop app/);
    navigate.openInWindow!.mockRejectedValueOnce(Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Open in own window' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/desktop app/);
  });

  it('hides the window button on hosts without detachable tabs', async () => {
    delete navigate.openInWindow;
    mount();
    await screen.findByRole('button', { name: 'Open Studio' });
    expect(screen.queryByRole('button', { name: 'Open in own window' })).toBeNull();
  });

  it('reopens a recent agent in its project and skips unknown projects', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10 * 86_400_000);
    recordRecentAgent('gone', 'x/Old.agent', 1);
    recordRecentAgent('draft', 'bots/Week.agent', 3 * 86_400_000);
    recordRecentAgent('draft', 'bots/Day.agent', 9 * 86_400_000);
    recordRecentAgent('sf', 'bots/Hours.agent', 10 * 86_400_000 - 3 * 3_600_000);
    recordRecentAgent('sf', 'bots/Minutes.agent', 10 * 86_400_000 - 5 * 60_000);
    recordRecentAgent('sf', 'force-app/aiAuthoringBundles/Help/Help.agent', 10 * 86_400_000);
    mount();
    const list = await screen.findByRole('list', { name: 'Recent agents' });
    expect([...list.querySelectorAll('li')].map(row => row.textContent)).toEqual([
      'Help · Agents · just nowOpen', 'Minutes · Agents · 5 min agoOpen', 'Hours · Agents · 3 h agoOpen',
      'Day · Drafts · yesterdayOpen', 'Week · Drafts · 7 days agoOpen',
    ]);
    fireEvent.click(screen.getByTitle('bots/Day.agent'));
    expect(takeQueuedAgentScriptOpen('draft')).toBe('bots/Day.agent');
    expect(readProjectView('draft')).toBe('agentforce');
    expect(navigate.toProject).toHaveBeenCalledWith('draft', { tabId: 'salesforce' });
    expect((screen.getByRole('combobox', { name: 'Project' }) as HTMLSelectElement).value).toBe('draft');
    vi.restoreAllMocks();
  });

  it('shows empty, flat and failed project lists', async () => {
    call.mockImplementation(async () => ({ ok: true, projects: [] }));
    mount();
    expect(await screen.findByText(/Add a local project folder/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Agentforce Studio/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Agentforce Studio/ }));
    expect(navigate.toProject).not.toHaveBeenCalled();
    cleanup();

    call.mockImplementation(async () => ({ ok: true, projects: [projects[2]] }));
    mount();
    const select = await screen.findByRole('combobox', { name: 'Project' });
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    cleanup();

    call.mockImplementationOnce(async () => ({ ok: false, error: 'Projects unavailable.' }));
    mount();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Projects unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Project' })).toBeTruthy();
  });
});

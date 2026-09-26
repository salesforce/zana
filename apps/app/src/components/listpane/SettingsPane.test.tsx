// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dismiss: null as (() => void) | null,
  ui: {
    settingsTab: 'global',
    setSettingsAnchor: vi.fn(),
    selectedProjectId: 'selected' as string | null,
    focusedProjectId: null as string | null
  },
  data: { projects: [{ id: 'selected', name: 'Demo' }] }
}));

vi.mock('../../store.js', () => ({
  useUi: (select: (state: typeof h.ui) => unknown) => select(h.ui),
  useData: (select: (state: typeof h.data) => unknown) => select(h.data)
}));
vi.mock('../../hooks/useAppSettingsRouteMemory.js', () => ({
  useAppSettingsRouteMemory: () => ({ appRoutePath: '/inbox' })
}));
vi.mock('../SidebarResizer.js', () => ({ SidebarResizer: () => null }));
vi.mock('../mobile-nav-context.js', () => ({ useMobileNavDismiss: () => h.dismiss }));

import { SettingsPane } from './SettingsPane.js';

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function mount() {
  return render(<MemoryRouter initialEntries={['/settings/global']}><SettingsPane /><Location /></MemoryRouter>);
}

beforeEach(() => {
  h.dismiss = null;
  h.ui.settingsTab = 'global';
  h.ui.selectedProjectId = 'selected';
  h.ui.focusedProjectId = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('focused Settings navigation', () => {
  it('dismisses the mobile drawer even when the selected section or anchor keeps the same route', () => {
    h.dismiss = vi.fn();
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Preferences' }));
    expect(h.dismiss).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'dark' } });
    fireEvent.click(screen.getByRole('link', { name: 'Appearance' }));
    expect(h.dismiss).toHaveBeenCalledTimes(2);
    expect(h.ui.setSettingsAnchor).toHaveBeenLastCalledWith('appearance');
    fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
    expect(h.dismiss).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('location').textContent).toBe('/inbox');
  });
  it('announces the current page, keeps other sections reachable, and returns to the prior app route', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Preferences' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Terminal' }).hasAttribute('aria-current')).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Terminal' }));
    expect(screen.getByTestId('location').textContent).toBe('/settings/terminal');
    expect(h.ui.setSettingsAnchor).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('link', { name: 'Back to app' }));
    expect(screen.getByTestId('location').textContent).toBe('/inbox');
  });

  it('finds a subsection by keyword and routes to its anchor', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search settings' }), { target: { value: 'dark' } });
    expect(screen.queryByRole('link', { name: 'Terminal' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Appearance' }));
    expect(h.ui.setSettingsAnchor).toHaveBeenCalledWith('appearance');
    expect(screen.getByTestId('location').textContent).toBe('/settings/global');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('link', { name: 'Terminal' })).toBeTruthy();
  });

  it('announces empty results and lets Escape clear the search without leaving Settings', () => {
    mount();
    const search = screen.getByRole('textbox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'no matching preference xyz' } });
    expect(screen.getByRole('status').textContent).toBe('No matching settings');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect((search as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByTestId('location').textContent).toBe('/settings/global');
  });

  it('resolves Project settings from focused, selected, and absent project context', () => {
    h.ui.focusedProjectId = 'focused';
    const first = mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/projects/focused/settings');
    first.unmount();
    h.ui.focusedProjectId = null;
    const second = mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/projects/selected/settings');
    second.unmount();
    h.ui.selectedProjectId = null;
    mount();
    expect(screen.getByRole('link', { name: 'Project settings' }).getAttribute('href')).toBe('/settings/project');
  });
});

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerSettingsPill, composerSettingsSummary, type SettingsGroup } from './ComposerSettingsPill.js';

afterEach(cleanup);

function groups(overrides: { mode?: Partial<SettingsGroup>; reasoning?: Partial<SettingsGroup>; permission?: Partial<SettingsGroup>; send?: Partial<SettingsGroup> } = {}) {
  const mode = vi.fn();
  const reasoning = vi.fn();
  const permission = vi.fn();
  const send = vi.fn();
  const refresh = vi.fn();
  const rows: SettingsGroup[] = [
    {
      id: 'mode', label: 'Composer mode', title: 'Mode', value: 'agent',
      choices: [{ value: 'agent', label: 'Agent', icon: <span>∞</span> }, { value: 'plan', label: 'Plan' }],
      onChange: mode, hint: 'Shift+Tab cycles modes', hideWhenSingle: true,
      action: { label: 'Refresh roles', onClick: refresh },
      ...overrides.mode
    },
    {
      id: 'reasoning', label: 'Thinking effort', title: 'Thinking', value: 'medium',
      choices: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
      onChange: reasoning,
      ...overrides.reasoning
    },
    {
      id: 'permission', label: 'Permission mode', title: 'Permissions', value: 'full',
      choices: [
        { value: 'accept-edits', label: 'Edits', description: 'CLI policy' },
        { value: 'full', label: 'Full', description: 'No sandbox and no approvals', tone: 'warning' }
      ],
      onChange: permission,
      ...overrides.permission
    },
    {
      id: 'send-mode', label: 'Send mode', title: 'Enter while running', value: 'auto',
      choices: [{ value: 'auto', label: 'Auto' }, { value: 'steer', label: 'Steer' }, { value: 'queue-if-active', label: 'Queue' }],
      onChange: send, hint: 'Enter queues while running',
      ...overrides.send
    }
  ];
  return { rows, mode, reasoning, permission, send, refresh };
}

describe('composerSettingsSummary', () => {
  it('leads with the mode, then thinking, and flags a warning permission', () => {
    const { rows } = groups();
    const summary = composerSettingsSummary(rows);
    expect(summary.parts).toEqual(['Agent', 'Medium']);
    expect(summary.mode?.value).toBe('agent');
    expect(summary.warning).toBe('Permissions: Full');
  });

  it('omits missing groups and safe permissions', () => {
    const { rows } = groups({ permission: { value: 'accept-edits' } });
    const summary = composerSettingsSummary(rows.filter((row) => row.id !== 'reasoning'));
    expect(summary.parts).toEqual(['Agent']);
    expect(summary.warning).toBeUndefined();
  });
});

describe('ComposerSettingsPill', () => {
  it('summarises the settings on the trigger', () => {
    const { rows } = groups();
    render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    expect(pill.textContent).toContain('Agent');
    expect(pill.textContent).toContain('Medium');
    expect(pill.getAttribute('title')).toBe('Agent · Medium · Permissions: Full');
    expect(pill.className).toContain('has-warning');
    expect(screen.getByLabelText('Permissions: Full')).toBeTruthy();
  });

  it('opens one menu with a radio group per setting and applies changes', () => {
    const { rows, mode, reasoning, permission, send, refresh } = groups();
    render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByTestId('composer-settings-menu');
    expect(within(menu).getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Composer mode', 'Thinking effort', 'Permission mode', 'Send mode']);
    expect(document.activeElement?.textContent).toContain('Agent');

    fireEvent.click(within(menu).getByRole('radio', { name: 'Plan' }));
    fireEvent.click(within(menu).getByRole('radio', { name: 'High' }));
    fireEvent.click(within(menu).getByRole('radio', { name: 'Edits' }));
    fireEvent.click(within(menu).getByRole('radio', { name: 'Steer' }));
    fireEvent.click(within(menu).getByRole('radio', { name: 'Auto' }));
    fireEvent.click(within(menu).getByRole('button', { name: 'Refresh roles' }));
    expect(mode).toHaveBeenCalledWith('plan');
    expect(reasoning).toHaveBeenCalledWith('high');
    expect(permission).toHaveBeenCalledWith('accept-edits');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('steer');
    expect(refresh).toHaveBeenCalledOnce();
    expect(menu.textContent).toContain('No sandbox and no approvals');
    expect(menu.textContent).toContain('Shift+Tab cycles modes');
  });

  it('moves the selection with arrow keys inside a group and closes on Escape', () => {
    const { rows, reasoning } = groups();
    render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    fireEvent.click(pill);
    const medium = screen.getByRole('radio', { name: 'Medium' });
    medium.focus();
    fireEvent.keyDown(medium, { key: 'ArrowRight' });
    expect(reasoning).toHaveBeenCalledWith('high');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Low' }), { key: 'ArrowLeft' });
    expect(reasoning).toHaveBeenLastCalledWith('high');
    fireEvent.keyDown(medium, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(medium, { key: 'Escape' });
    expect(screen.queryByTestId('composer-settings-menu')).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('closes on Escape even after the focused choice unmounts', () => {
    const { rows } = groups();
    const { rerender } = render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    fireEvent.click(pill);
    rerender(<ComposerSettingsPill groups={rows.filter((row) => row.id !== 'mode')} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByTestId('composer-settings-menu')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('composer-settings-menu')).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('closes when clicking outside but not inside', () => {
    const { rows } = groups();
    render(<><button>outside</button><ComposerSettingsPill groups={rows} /></>);
    fireEvent.click(screen.getByTestId('composer-settings-pill'));
    fireEvent.mouseDown(screen.getByTestId('composer-settings-menu'));
    expect(screen.getByTestId('composer-settings-menu')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByTestId('composer-settings-menu')).toBeNull();
  });

  it('hides a single-choice mode from the menu but keeps it in the summary', () => {
    const { rows } = groups({ mode: { choices: [{ value: 'agent', label: 'Agent' }] }, permission: { choices: [] } });
    render(<ComposerSettingsPill groups={rows} />);
    fireEvent.click(screen.getByTestId('composer-settings-pill'));
    expect(screen.getByTestId('composer-settings-pill').textContent).toContain('Agent');
    expect(screen.queryByTestId('composer-settings-mode')).toBeNull();
    expect(screen.queryByTestId('composer-settings-permission')).toBeNull();
    expect(screen.getByTestId('composer-settings-reasoning')).toBeTruthy();
  });

  it('becomes a static label when nothing can change and disappears when empty', () => {
    const { rows } = groups();
    const only = [{ ...rows[0]!, choices: [{ value: 'agent', label: 'Agent' }] }];
    const { rerender } = render(<ComposerSettingsPill groups={only} />);
    const pill = screen.getByTestId('composer-settings-pill') as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
    rerender(<ComposerSettingsPill groups={[{ ...rows[0]!, choices: [] }]} />);
    expect(screen.queryByTestId('composer-settings-pill')).toBeNull();
  });

  it('respects disabled and wraps long choice lists', () => {
    const { rows } = groups({
      reasoning: { choices: ['a', 'b', 'c', 'd', 'e'].map((value) => ({ value, label: value })) }
    });
    const { rerender } = render(<ComposerSettingsPill groups={rows} disabled />);
    expect((screen.getByTestId('composer-settings-pill') as HTMLButtonElement).disabled).toBe(true);
    rerender(<ComposerSettingsPill groups={rows} />);
    fireEvent.click(screen.getByTestId('composer-settings-pill'));
    expect(screen.getByRole('radiogroup', { name: 'Thinking effort' }).className).toContain('is-wrapping');
  });

  it('places the menu above the trigger when there is no room below', () => {
    const { rows } = groups();
    render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    pill.getBoundingClientRect = () => ({ left: 400, right: 520, top: window.innerHeight - 40, bottom: window.innerHeight - 12, width: 120, height: 28, x: 400, y: 0, toJSON: () => ({}) });
    fireEvent.click(pill);
    const menu = screen.getByTestId('composer-settings-menu');
    expect(menu.style.top).toBe('auto');
    expect(menu.style.bottom).not.toBe('');
  });

  it('opens below the trigger when there is room', () => {
    const { rows } = groups();
    render(<ComposerSettingsPill groups={rows} />);
    const pill = screen.getByTestId('composer-settings-pill');
    pill.getBoundingClientRect = () => ({ left: 10, right: 130, top: 10, bottom: 38, width: 120, height: 28, x: 10, y: 10, toJSON: () => ({}) });
    fireEvent.click(pill);
    expect(screen.getByTestId('composer-settings-menu').style.bottom).toBe('auto');
  });
});

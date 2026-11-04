// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries as terminalEntries } from '@/lib/settings-search/entries/terminal';

vi.mock('../../lib/product-client.js', () => ({
  product: {
    terminals: {
      verifyTmux: vi.fn().mockResolvedValue({ installed: true, version: 'tmux 3.4', installHint: '' })
    }
  }
}));

import { TerminalSettingsView } from './TerminalSettingsView';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('TerminalSettingsView settings-search targets', () => {
  it('renders a live target for every indexed Terminal entry', async () => {
    const { container, findByText } = render(
      <TerminalSettingsView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    await findByText('tmux 3.4');
    await waitFor(() => expect(container.querySelector('[data-settings-target="terminal.tmux-status"]')).not.toBeNull());
    const present = new Set(
      Array.from(container.querySelectorAll('[data-settings-target]')).map((n) => n.getAttribute('data-settings-target'))
    );
    expect(terminalEntries.length).toBeGreaterThan(0);
    for (const e of terminalEntries) expect(present, e.id).toContain(e.id);
  });
});

describe('TerminalSettingsView Ctrl+V pastes', () => {
  const toggle = () => screen.getByRole('switch', { name: 'Ctrl+V pastes' });

  it('is on by default on Windows and saves the change', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<TerminalSettingsView config={config} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    await screen.findByText('tmux 3.4');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle());
    expect(onUpdate).toHaveBeenCalledWith({ terminalCtrlVPasteEnabled: false });
  });

  it('is off by default on Linux and shows a stored value', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    const { rerender } = render(<TerminalSettingsView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText('tmux 3.4');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    rerender(<TerminalSettingsView config={{ ...config, terminalCtrlVPasteEnabled: true }} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  });

  it('is disabled on macOS, where Cmd+V pastes', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    render(<TerminalSettingsView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />);
    await screen.findByText('tmux 3.4');
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
  });
});

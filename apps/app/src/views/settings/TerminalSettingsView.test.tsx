// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
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

afterEach(cleanup);

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

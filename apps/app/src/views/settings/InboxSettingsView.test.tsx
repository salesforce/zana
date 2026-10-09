// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries as inboxEntries } from '@/lib/settings-search/entries/inbox';
import { entries as connectivityEntries } from '@/lib/settings-search/entries/connectivity';
import { InboxSettingsView } from './InboxSettingsView';
import { ConnectivityView } from './ConnectivityView';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

function targets(container: HTMLElement): Set<string | null> {
  return new Set(
    Array.from(container.querySelectorAll('[data-settings-target]')).map((n) => n.getAttribute('data-settings-target'))
  );
}

afterEach(cleanup);

describe('Inbox and Connectivity settings-search targets', () => {
  it('Inbox renders a live target for every indexed entry', () => {
    const { container } = render(
      <InboxSettingsView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
    );
    const present = targets(container);
    expect(inboxEntries.length).toBeGreaterThan(0);
    for (const e of inboxEntries) expect(present, e.id).toContain(e.id);
  });

  it('Connectivity renders a live target for every indexed entry', () => {
    const { container } = render(
      <ConnectivityView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
    );
    const present = targets(container);
    expect(connectivityEntries.length).toBeGreaterThan(0);
    for (const e of connectivityEntries) expect(present, e.id).toContain(e.id);
  });
});

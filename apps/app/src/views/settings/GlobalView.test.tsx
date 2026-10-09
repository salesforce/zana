// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries as globalEntries } from '@/lib/settings-search/entries/global';

vi.mock('../../lib/product-client.js', () => ({
  product: {
    deps: { check: vi.fn() },
    cliSkills: {
      status: vi.fn().mockResolvedValue({ machines: [] }),
      install: vi.fn().mockResolvedValue({ results: [] })
    },
    projects: { ensureQuickAgent: vi.fn() }
  }
}));
vi.mock('@/hooks/useHosts', () => ({ useHosts: () => [] }));
vi.mock('@/plugins/PluginAppearanceSettings', () => ({
  PluginThemePicker: () => null,
  PluginThreadListPicker: () => null
}));
vi.mock('../../components/AgentLauncher.js', () => ({ buildLaunchArgs: () => ({}) }));
vi.mock('@/store', () => {
  const useData = (selector: (s: { createTerminal: () => void }) => unknown) =>
    selector({ createTerminal: () => undefined });
  const useUi = { getState: () => ({ setWalkthroughOpen: vi.fn(), setSetupOpen: vi.fn() }) };
  return { useData, useUi };
});

import { GlobalView } from './GlobalView';

const config: AppConfig = {
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};

afterEach(cleanup);

describe('GlobalView settings-search targets', () => {
  it('renders a live target for every indexed Global entry', async () => {
    const { container } = render(
      <GlobalView config={config} onConfigDraft={vi.fn()} onUpdate={vi.fn().mockResolvedValue(undefined)} />
    );
    await waitFor(() => expect(container.querySelector('[data-settings-target]')).not.toBeNull());
    const present = new Set(
      Array.from(container.querySelectorAll('[data-settings-target]')).map((n) =>
        n.getAttribute('data-settings-target')
      )
    );
    const expected = globalEntries.map((e) => e.id);
    expect(expected.length).toBeGreaterThan(0);
    for (const id of expected) expect(present, id).toContain(id);
  });
});

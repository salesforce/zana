/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  native: vi.fn(),
  legacy: vi.fn(),
  bundles: vi.fn(),
  toggle: vi.fn(),
  reveal: vi.fn(),
  off: vi.fn(),
  projectId: 'p',
  setFilter: vi.fn(),
  projects: [
    { id: 'p', path: '/project' },
    { id: 'other', path: '/other' }
  ]
}));
vi.mock('../../lib/native-capabilities.js', () => ({ nativeCapabilities: state.native }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    pluginApps: { onChanged: () => state.off },
    skills: {
      list: state.legacy,
      setEnabled: state.toggle,
      reveal: state.reveal,
      onChanged: () => state.off,
      bundles: { list: state.bundles, onChanged: () => state.off }
    }
  }
}));
vi.mock('@/store', () => ({
  useData: (selector: (s: unknown) => unknown) => selector({ projects: state.projects }),
  useUi: (selector: (s: unknown) => unknown) =>
    selector({
      selectedProjectId: state.projectId,
      catalogueFilter: {},
      setCatalogueFilter: state.setFilter
    })
}));
import { SkillsBody } from './SkillsView.js';
const skill = {
  id: 'user:review',
  name: 'review',
  description: 'Review the code',
  tool: 'claude-code',
  toolLabel: 'Claude Code',
  source: 'user',
  path: '/skill',
  enabled: true,
  toggle: { supported: true, enabled: true },
  kind: 'skill',
  linked: true,
  disableModelInvocation: true
};
beforeEach(() => {
  state.legacy.mockReset().mockResolvedValue([]);
  state.native
    .mockReset()
    .mockResolvedValue({
      skills: [
        skill,
        {
          ...skill,
          id: 'cmd',
          name: 'grill-me',
          kind: 'command',
          source: 'plugin',
          pluginName: 'plugin',
          userInvocable: false,
          linked: false,
          toggle: { supported: false },
          revealable: false
        }
      ],
      diagnostics: []
    });
  state.bundles.mockReset().mockResolvedValue([]);
  state.toggle.mockReset().mockResolvedValue(undefined);
  state.reveal.mockReset().mockResolvedValue({ ok: true });
  state.off.mockReset();
});
afterEach(cleanup);
it('shows commands, origins and author flags, and only offers authorized toggles/reveal', async () => {
  render(<SkillsBody projectId="p" />);
  await screen.findByText('grill-me');
  expect(state.native).toHaveBeenCalledWith({ projectId: 'p' });
  expect(screen.getByText('Command')).toBeTruthy();
  expect(screen.getByText('Agent only')).toBeTruthy();
  expect(screen.getAllByText('Manual only')).toHaveLength(2);
  expect(screen.getAllByText('Linked')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }));
  expect(state.reveal).toHaveBeenCalledWith('user:review', '/project');
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() => expect(state.toggle).toHaveBeenCalledWith('review', false));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search skills' }), {
    target: { value: 'grill' }
  });
  expect(screen.queryByText('review')).toBeNull();
});
it('shows unavailable-host diagnostics and refreshes without discarding the page', async () => {
  state.native.mockRejectedValueOnce(new Error('Execution host is offline'));
  render(<SkillsBody />);
  await screen.findByText('Execution host is offline');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh skills', exact: true }));
  await screen.findByText('grill-me');
  expect(screen.queryByText('Execution host is offline')).toBeNull();
  state.native.mockResolvedValue({ skills: [], diagnostics: ['Listing reached its limit'] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh skills', exact: true }));
  await screen.findByText('Listing reached its limit');
});
it('ignores stale project results and does not let bundle failures hide discovery', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  state.native.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFirst = resolve;
    })
  );
  state.bundles.mockRejectedValue(new Error('Bundles unavailable'));
  const view = render(<SkillsBody projectId="p" />);
  view.rerender(<SkillsBody projectId="other" />);
  await act(async () => {
    resolveFirst({ skills: [{ ...skill, name: 'stale' }], diagnostics: [] });
  });
  await screen.findByText('grill-me');
  expect(screen.queryByText('stale')).toBeNull();
  view.unmount();
  expect(state.off).toHaveBeenCalled();
});
it('rolls back a failed toggle', async () => {
  state.toggle.mockRejectedValue(new Error('Write failed'));
  render(<SkillsBody />);
  await screen.findByText('review');
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  );
});

it('keeps local rule files alongside native skills without duplicating legacy skill rows', async () => {
 state.legacy.mockResolvedValue([{ ...skill, id: 'rule:project', name: 'Project rule', kind: 'rule', linked: false, disableModelInvocation: false, toggle: { supported: false, enabled: true } }, skill]);
 render(<SkillsBody projectId="p" />);
 await screen.findByText('Project rule');
 expect(screen.getByText('Rule')).toBeTruthy();
 expect(screen.getAllByText('review')).toHaveLength(1);
});

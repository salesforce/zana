/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  native: vi.fn(),
  legacy: vi.fn(),
  bundles: vi.fn(),
  toggle: vi.fn(),
  setState: vi.fn(),
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
      setState: state.setState,
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
import { fileManagerName } from '../../lib/file-manager.js';
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
  state.setState.mockReset().mockResolvedValue({ ok: true, applied: 1, rejected: 0 });
  state.reveal.mockReset().mockResolvedValue({ ok: true });
  state.off.mockReset();
});
afterEach(cleanup);
it('restarts the saved feedback timer and cancels it when the page unmounts', async () => {
  const view = render(<SkillsBody />);
  await screen.findByText('review');
  vi.useFakeTimers();
  try {
    await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.queryByText('Saved')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('checkbox')); });
    expect(screen.getByText('Saved')).toBeTruthy();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
it('does not schedule saved feedback when a write finishes after unmount', async () => {
  let finish!: () => void;
  state.toggle.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<SkillsBody />);
  await screen.findByText('review');
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('checkbox'));
    view.unmount();
    await act(async () => { finish(); });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
it('shows commands, origins and author flags, and only offers authorized toggles/reveal', async () => {
  render(<SkillsBody projectId="p" />);
  await screen.findByText('grill-me');
  expect(state.native).toHaveBeenCalledWith({ projectId: 'p' });
  expect(screen.getByText('Command')).toBeTruthy();
  expect(screen.getByText('Agent only')).toBeTruthy();
  expect(screen.getAllByText('Manual only')).toHaveLength(2);
  expect(screen.getAllByText('Linked')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: `Reveal in ${fileManagerName()}` }));
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

const injected = {
  ...skill,
  id: 'zcc:gus/gus-work',
  name: 'gus-work',
  tool: 'zcc',
  toolLabel: 'All harnesses',
  allHarnesses: true,
  source: 'plugin',
  pluginName: 'gus',
  linked: false,
  disableModelInvocation: false,
  revealable: false,
  toggle: { supported: true, enabled: true, state: 'on', states: ['on', 'manual', 'off'] }
};
const codex = { ...skill, id: 'codex:user:lint', name: 'lint', tool: 'codex', toolLabel: 'Codex', disableModelInvocation: false, toggle: { supported: false, enabled: true } };

it('sets a tri-state load policy and rolls back when the owner rejects it', async () => {
  state.native.mockResolvedValue({ skills: [skill, injected], diagnostics: [] });
  render(<SkillsBody />);
  await screen.findByText('gus-work');
  expect(screen.getByText('ZCC · gus')).toBeTruthy();
  const group = screen.getByRole('radiogroup', { name: 'Load state for gus-work' });
  const radio = (label: string) => Array.from(group.querySelectorAll('[role="radio"]')).find((el) => el.textContent === label) as HTMLElement;
  expect(radio('On').getAttribute('aria-checked')).toBe('true');
  fireEvent.click(radio('Manual'));
  await waitFor(() => expect(radio('Manual').getAttribute('aria-checked')).toBe('true'));
  expect(state.setState).toHaveBeenCalledWith([{ id: 'zcc:gus/gus-work', name: 'gus-work', state: 'manual' }]);
  fireEvent.click(radio('Manual'));
  expect(state.setState).toHaveBeenCalledTimes(1);
  state.setState.mockResolvedValue({ ok: false, applied: 0, rejected: 1 });
  fireEvent.click(radio('Off'));
  await waitFor(() => expect(state.setState).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(radio('Manual').getAttribute('aria-checked')).toBe('true'));
  state.setState.mockRejectedValue(new Error('boom'));
  fireEvent.click(radio('On'));
  await waitFor(() => expect(state.setState).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(radio('Manual').getAttribute('aria-checked')).toBe('true'));
});

it('filters by harness and load state; shared ZCC skills appear under every harness', async () => {
  state.native.mockResolvedValue({
    skills: [skill, codex, { ...injected, toggle: { ...injected.toggle, state: 'off', enabled: false }, enabled: false }],
    diagnostics: []
  });
  render(<SkillsBody />);
  await screen.findByText('lint');
  const harness = screen.getByRole('tablist', { name: 'Harness filter' });
  fireEvent.click(Array.from(harness.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Codex'))!);
  expect(screen.queryByText('review')).toBeNull();
  expect(screen.getByText('lint')).toBeTruthy();
  expect(screen.getByText('gus-work')).toBeTruthy();
  fireEvent.click(Array.from(harness.querySelectorAll('button')).find((b) => b.textContent === 'All harnesses')!);
  const states = screen.getByRole('tablist', { name: 'State filter' });
  fireEvent.click(Array.from(states.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Off'))!);
  expect(screen.queryByText('review')).toBeNull();
  expect(screen.getByText('gus-work')).toBeTruthy();
  fireEvent.click(Array.from(states.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Any state'))!);
  fireEvent.change(screen.getByLabelText('Search skills'), { target: { value: 'harness:codex state:on' } });
  await waitFor(() => expect(screen.queryByText('review')).toBeNull());
  expect(screen.getByText('lint')).toBeTruthy();
  expect(screen.queryByText('gus-work')).toBeNull();
});
const fm = (harness: string, path: string, line: number) =>
  `${harness}: Invalid frontmatter in ${path} (line ${line}): bad yaml`;
const withDiagnostics = (diagnostics: string[]) =>
  state.native.mockResolvedValue({ skills: [skill], diagnostics });
it('renders one in-flow status entry for the same file reported by three harnesses', async () => {
  withDiagnostics([fm('Claude Code', '/a/SKILL.md', 2), fm('Codex', '/a/SKILL.md', 3), fm('OpenCode', '/a/SKILL.md', 4)]);
  render(<SkillsBody />);
  const status = await screen.findByRole('status');
  expect(status.className).toBe('skills-discovery-notes');
  expect(status.querySelectorAll('li')).toHaveLength(1);
  expect(status.textContent).not.toContain('Codex:');
});
it('renders two entries for two different files', async () => {
  withDiagnostics([fm('Claude Code', '/a/SKILL.md', 2), fm('Codex', '/b/SKILL.md', 2)]);
  render(<SkillsBody />);
  expect((await screen.findByRole('status')).querySelectorAll('li')).toHaveLength(2);
});
it('caps at three entries with an N more expander', async () => {
  withDiagnostics([1, 2, 3, 4, 5].map((i) => fm('Codex', `/s${i}/SKILL.md`, 1)));
  render(<SkillsBody />);
  const status = await screen.findByRole('status');
  expect(status.querySelectorAll('li')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '2 more' }));
  expect(status.querySelectorAll('li')).toHaveLength(5);
  expect(screen.queryByRole('button', { name: '2 more' })).toBeNull();
});
it('dismisses the notice and re-shows it when a new diagnostic appears', async () => {
  withDiagnostics([fm('Codex', '/a/SKILL.md', 1)]);
  render(<SkillsBody />);
  await screen.findByRole('status');
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh skills', exact: true }));
  await screen.findByText('grill-me').catch(() => undefined);
  await waitFor(() => expect(state.native).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('status')).toBeNull();
  withDiagnostics([fm('Codex', '/a/SKILL.md', 1), fm('Codex', '/new/SKILL.md', 1)]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh skills', exact: true }));
  const status = await screen.findByRole('status');
  expect(status.querySelectorAll('li')).toHaveLength(2);
});
it('renders no notice without diagnostics', async () => {
  render(<SkillsBody />);
  await screen.findByText('grill-me');
  expect(screen.queryByRole('status')).toBeNull();
});

/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
import { ProjectSkillsView } from './ProjectSkillsView.js';
const skill = {
  id: 'user:review', name: 'review', description: 'Review', tool: 'claude-code', toolLabel: 'Claude Code',
  source: 'user', path: '/skill', enabled: true, toggle: { supported: true, enabled: true }, kind: 'skill', linked: true
};
const fm = (harness: string, path: string) => `${harness}: Invalid frontmatter in ${path} (line 2): bad yaml`;
beforeEach(() => {
  state.legacy.mockReset().mockResolvedValue([]);
  state.bundles.mockReset().mockResolvedValue([]);
  state.native.mockReset().mockResolvedValue({
    skills: [skill],
    diagnostics: [fm('Claude Code', '/a/SKILL.md'), fm('Codex', '/a/SKILL.md'), fm('OpenCode', '/a/SKILL.md'), fm('Codex', '/b/SKILL.md')]
  });
});
afterEach(cleanup);
it('shows deduplicated diagnostics in the project skills tab', async () => {
  render(<ProjectSkillsView project={{ id: 'p', path: '/project' } as never} />);
  const status = await screen.findByRole('status');
  expect(status.querySelectorAll('li')).toHaveLength(2);
  expect(state.native).toHaveBeenCalledWith({ projectId: 'p' });
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByRole('status')).toBeNull();
});

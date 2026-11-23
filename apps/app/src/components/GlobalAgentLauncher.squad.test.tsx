/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ui: { launcherProjectId: null as string | null, launcherTeamId: null as string | null },
  props: [] as Array<Record<string, unknown>>
}));
vi.mock('../store.js', () => ({ useUi: (sel: (s: unknown) => unknown) => sel(h.ui) }));
vi.mock('./AgentLauncher.js', () => ({ AgentLauncher: (p: Record<string, unknown>) => { h.props.push(p); return null; } }));

import { GlobalAgentLauncher } from './GlobalAgentLauncher.js';

afterEach(() => { cleanup(); h.props = []; h.ui = { launcherProjectId: null, launcherTeamId: null }; });

describe('GlobalAgentLauncher Squad prefill', () => {
  it('opens on the Squad composer with the Squad and project pre-selected', () => {
    h.ui = { launcherProjectId: 'p1', launcherTeamId: 't1' };
    render(<GlobalAgentLauncher open onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).toMatchObject({ initialMode: 'team', initialTeamId: 't1', initialProjectId: 'p1' });
  });

  it('does not force the Squad composer on a generic open', () => {
    render(<GlobalAgentLauncher open onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).not.toHaveProperty('initialMode');
    expect(h.props.at(-1)).not.toHaveProperty('initialTeamId');
  });

  it('renders nothing when closed', () => {
    render(<GlobalAgentLauncher open={false} onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props).toHaveLength(0);
  });
});

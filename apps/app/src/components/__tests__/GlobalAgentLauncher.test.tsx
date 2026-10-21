/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ui: { launcherProjectId: null as string | null },
  props: [] as Array<Record<string, unknown>>
}));

vi.mock('../../store.js', () => ({
  useUi: (sel: (s: typeof h.ui) => unknown) => sel(h.ui)
}));
vi.mock('../AgentLauncher.js', () => ({
  AgentLauncher: (props: Record<string, unknown>) => { h.props.push(props); return <div data-testid="launcher" />; }
}));

import { GlobalAgentLauncher } from '../GlobalAgentLauncher.js';

afterEach(() => { cleanup(); h.props = []; h.ui.launcherProjectId = null; });

describe('GlobalAgentLauncher', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<GlobalAgentLauncher open={false} onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(h.props).toHaveLength(0);
  });

  it('passes the project a row "+" opened it for', () => {
    h.ui.launcherProjectId = 'remote-1';
    render(<GlobalAgentLauncher open onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).toMatchObject({ initialProjectId: 'remote-1' });
  });

  it('passes no project for a generic open', () => {
    render(<GlobalAgentLauncher open onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).toMatchObject({ initialProjectId: undefined });
  });

  it('uses the clicked row instead of a previously focused project', () => {
    h.ui.launcherProjectId = 'clicked';
    render(<GlobalAgentLauncher open project={{ id: 'previous', name: 'Previous' } as never} onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).toMatchObject({ project: undefined, initialProjectId: 'clicked' });
  });

  it('keeps a generic project launch pinned to its project', () => {
    const project = { id: 'focused', name: 'Focused' } as never;
    render(<GlobalAgentLauncher open project={project} onClose={vi.fn()} onLaunched={vi.fn()} />);
    expect(h.props.at(-1)).toMatchObject({ project, initialProjectId: undefined });
  });
});

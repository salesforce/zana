// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const surface = vi.hoisted(() => ({ compact: false, kind: 'desktop' }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => surface.compact }));
vi.mock('../lib/app-surface.js', () => ({ getAppSurface: () => surface.kind }));

import { CliAgentSurface } from './CliAgentSurface.js';

afterEach(() => {
  cleanup();
  surface.compact = false;
  surface.kind = 'desktop';
});

it.each(['desktop', 'web'])('keeps the agent content on the wide %s surface', (kind) => {
  surface.kind = kind;
  render(<CliAgentSurface><div>Agent terminal</div></CliAgentSurface>);
  expect(screen.getByText('Agent terminal')).toBeTruthy();
  expect(screen.queryByTestId('cli-agent-mobile-unsupported')).toBeNull();
});

it.each([
  { kind: 'web', compact: true },
  { kind: 'mobile', compact: true },
  { kind: 'mobile', compact: false }
])('explains the limitation without mounting agent content on $kind / compact=$compact', ({ kind, compact }) => {
  Object.assign(surface, { kind, compact });
  const content = vi.fn(() => <div>Agent terminal</div>);
  const AgentContent = content;
  render(<CliAgentSurface><AgentContent /></CliAgentSurface>);
  expect(content).not.toHaveBeenCalled();
  expect(screen.getByRole('heading').textContent).toBe('CLI Agents aren’t supported on mobile yet');
  expect(screen.getByText(/Open this agent in the desktop app/)).toBeTruthy();
  const notice = screen.getByTestId('cli-agent-mobile-unsupported');
  expect(notice.getAttribute('data-art')).toBe('mobile');
  expect(notice.querySelector('.pane-empty-art')?.getAttribute('aria-hidden')).toBe('true');
  expect(notice.querySelector('[data-scene="mobile"] .fairy-mobile-laptop')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it('updates the fallback when a web viewport changes size', () => {
  surface.kind = 'web';
  const view = <CliAgentSurface><div>Agent terminal</div></CliAgentSurface>;
  const { rerender } = render(view);
  surface.compact = true;
  rerender(<CliAgentSurface><div>Agent terminal</div></CliAgentSurface>);
  expect(screen.queryByText('Agent terminal')).toBeNull();
  expect(screen.getByTestId('cli-agent-mobile-unsupported')).toBeTruthy();
  surface.compact = false;
  rerender(<CliAgentSurface><div>Agent terminal</div></CliAgentSurface>);
  expect(screen.getByText('Agent terminal')).toBeTruthy();
  expect(screen.queryByTestId('cli-agent-mobile-unsupported')).toBeNull();
});

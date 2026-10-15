// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostInstallStages } from '../HostInstallStages.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('HostInstallStages', () => {
  it('renders nothing without stages', () => {
    const { container } = render(<HostInstallStages stages={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders stages in order with ticking elapsed / limit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    render(<HostInstallStages stages={[
      { stage: 'ssh', status: 'passed', startedAt: 1_000_000 - 5000 },
      { stage: 'install', status: 'running', startedAt: 1_000_000, limitMs: 120_000 },
      { stage: 'wait', status: 'running' }
    ]} />);
    const items = screen.getAllByRole('listitem').map((li) => li.getAttribute('data-testid'));
    expect(items).toEqual(['host-install-stage-ssh', 'host-install-stage-install', 'host-install-stage-wait']);
    expect(screen.getByText('Connecting over SSH')).toBeTruthy();
    expect(screen.getByTestId('host-install-stage-time-install').textContent).toBe('0:00 / 2:00');
    expect(screen.queryByTestId('host-install-stage-time-wait')).toBeNull();
    act(() => { vi.advanceTimersByTime(65_000); });
    expect(screen.getByTestId('host-install-stage-time-install').textContent).toBe('1:05 / 2:00');
  });

  it('fails a running stage client-side at the limit and clears the interval on unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clear = vi.spyOn(window, 'clearInterval');
    const view = render(<HostInstallStages stages={[
      { stage: 'wait', status: 'running', startedAt: 0, limitMs: 3000 }
    ]} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByTestId('host-install-stage-wait').getAttribute('data-status')).toBe('failed');
    expect(screen.getByTestId('host-install-stage-reason-wait').textContent).toBe('Timed out after 0:03');
    view.unmount();
    expect(clear).toHaveBeenCalled();
  });

  it('shows reason and a Retry on the last failed stage only; failure without reason falls back', () => {
    const onRetry = vi.fn();
    render(<HostInstallStages onRetry={onRetry} stages={[
      { stage: 'ssh', status: 'failed', reason: 'Permission denied' },
      { stage: 'tunnel', status: 'failed' },
      { stage: 'install', status: 'passed' }
    ]} />);
    expect(screen.getByTestId('host-install-stage-reason-ssh').textContent).toBe('Permission denied');
    expect(screen.getByTestId('host-install-stage-reason-tunnel').textContent).toBe('Failed');
    expect(screen.getAllByTestId('host-install-retry')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('host-install-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits Retry without a handler', () => {
    render(<HostInstallStages stages={[{ stage: 'ssh', status: 'failed', reason: 'x' }]} />);
    expect(screen.queryByTestId('host-install-retry')).toBeNull();
  });
});

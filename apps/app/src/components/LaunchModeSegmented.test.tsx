/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LaunchModeSegmented } from './LaunchModeSegmented.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LaunchModeSegmented', () => {
  it('lists CLI Agent first, then Modern', () => {
    render(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam showJobTeam />
    );
    const order = screen.getAllByRole('button').map((button) => {
      const text = button.textContent ?? '';
      if (text.includes('CLI Agent')) return 'agent';
      if (text.includes('Modern')) return 'thread';
      if (text.includes('Autonomous')) return 'autonomous';
      if (text.includes('Job Team')) return 'job';
      return text;
    });
    expect(order).toEqual(['agent', 'thread', 'autonomous', 'job']);
  });

  it('offers CLI Agent and Modern by default', () => {
    const { container } = render(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam={false} showJobTeam={false} />
    );
    expect(container.querySelector('[aria-label="Launch mode"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /CLI Agent/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Modern/ })).toBeTruthy();
    expect(container.querySelector('.launch-segmented-new')?.textContent).toBe('NEW');
    expect(screen.queryByRole('button', { name: /Autonomous Team/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Job Team/ })).toBeNull();
  });

  it('hides CLI Agent when showCliAgent is false', () => {
    render(
      <LaunchModeSegmented
        value="thread"
        onChange={() => undefined}
        showCliAgent={false}
        showModern
        showAutonomousTeam={false}
        showJobTeam={false}
      />
    );
    expect(screen.queryByRole('button', { name: /CLI Agent/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Modern/ })).toBeTruthy();
  });

  it('hides Modern when showModern is false', () => {
    render(
      <LaunchModeSegmented
        value="agent"
        onChange={() => undefined}
        showCliAgent
        showModern={false}
        showAutonomousTeam={false}
        showJobTeam={false}
      />
    );
    expect(screen.getByRole('button', { name: /CLI Agent/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Modern/ })).toBeNull();
  });

  it('shows Autonomous Team only when teams exist', () => {
    render(
      <LaunchModeSegmented value="autonomous" onChange={() => undefined} showAutonomousTeam showJobTeam={false} />
    );
    const button = screen.getByRole('button', { name: /Autonomous Team/ });
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the Job Team button only when showJobTeam is true', () => {
    const { rerender } = render(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam showJobTeam={false} />
    );
    expect(screen.queryByRole('button', { name: /Job Team/ })).toBeNull();
    rerender(
      <LaunchModeSegmented value="thread" onChange={() => undefined} showAutonomousTeam showJobTeam />
    );
    expect(screen.getByRole('button', { name: /Job Team/ })).toBeTruthy();
  });

  it('fires onChange("job") when the Job Team button is clicked', () => {
    const onChange = vi.fn();
    render(
      <LaunchModeSegmented value="thread" onChange={onChange} showAutonomousTeam showJobTeam />
    );
    fireEvent.click(screen.getByRole('button', { name: /Job Team/ }));
    expect(onChange).toHaveBeenCalledWith('job');
  });

  it('marks the active Job Team mode with aria-pressed', () => {
    render(
      <LaunchModeSegmented value="job" onChange={() => undefined} showAutonomousTeam showJobTeam />
    );
    expect(screen.getByRole('button', { name: /Job Team/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /CLI Agent/ }).getAttribute('aria-pressed')).toBe('false');
  });
});

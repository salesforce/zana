// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchModeSegmented } from './LaunchModeSegmented.js';

afterEach(cleanup);

describe('LaunchModeSegmented', () => {
  it('renders one Team choice and selects it', () => {
    const onChange = vi.fn();
    render(<LaunchModeSegmented value="thread" onChange={onChange} showTeam />);
    expect(screen.getByRole('button', { name: 'Team' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Autonomous Team|Job Team/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    expect(onChange).toHaveBeenCalledWith('team');
  });

  it('hides Team when disabled', () => {
    render(<LaunchModeSegmented value="thread" onChange={() => undefined} showTeam={false} />);
    expect(screen.queryByRole('button', { name: 'Team' })).toBeNull();
  });
});

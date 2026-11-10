/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginBadge } from './HarnessView.js';

afterEach(cleanup);

describe('LoginBadge', () => {
  it('tells a signed-out user which command to run and what to click next', () => {
    render(<LoginBadge login={{ state: 'sign_in_required', loginCommand: 'cursor-agent login' }} />);
    const badge = screen.getByText('sign in').closest('span');
    expect(badge?.getAttribute('title')).toBe(
      'Not signed in. Run "cursor-agent login" in a terminal, then click Check status.'
    );
    // The fix is visible without hovering.
    expect(screen.getByTestId('harness-login-command').textContent).toBe('cursor-agent login');
  });

  it('keeps the unverified and signed-in states distinct', () => {
    const { rerender } = render(<LoginBadge login={{ state: 'unverified', loginCommand: 'codex login' }} />);
    expect(screen.getByText('login unverified').getAttribute('title')).toContain('codex login');
    rerender(<LoginBadge login={{ state: 'signed_in', loginCommand: 'codex login' }} />);
    expect(screen.getByText('signed in')).toBeTruthy();
  });
});

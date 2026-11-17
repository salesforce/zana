// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ auth: {} as any, check: vi.fn(), start: vi.fn(), cancel: vi.fn() }));
vi.mock('../../hooks/useProviderAuthentication.js', () => ({ useProviderAuthentication: () => fixture.auth }));
vi.mock('../../components/TerminalView.js', () => ({ TerminalView: () => <div data-testid="login-terminal" /> }));
import { ProviderAuthentication } from './ProviderAuthentication.js';
const view = (hostId: string | undefined = 'h1') => render(<ProviderAuthentication providerId="fixture" name="Fixture" hostId={hostId} hostName="Selected machine" onReady={vi.fn()} />);
beforeEach(() => { vi.clearAllMocks(); fixture.auth = { result: null, checking: false, starting: false, session: null, error: null, check: fixture.check, start: fixture.start, cancel: fixture.cancel }; });
afterEach(cleanup);
it('shows a ready gateway without offering OAuth sign-in', () => {
  fixture.auth.result = { supported: true, health: { status: 'ready', statusMessage: 'Enterprise gateway credentials configured.', loginCommand: null, accountEmail: 'user@example.com', planLabel: 'Enterprise' } };
  view(); expect(screen.getByText('Credentials ready')).toBeTruthy(); expect(screen.getByText('Enterprise gateway credentials configured.')).toBeTruthy();
  expect(screen.getByText('user@example.com')).toBeTruthy(); expect(screen.getByText('Enterprise')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Sign in to Fixture' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check Fixture credentials' })); expect(fixture.check).toHaveBeenCalledOnce();
});
it.each([['unauthenticated', 'Sign-in required'], ['expired', 'Sign-in expired'], ['not_installed', 'CLI not installed'], ['unsupported_version', 'CLI update required'], ['unknown', 'Credentials unverified']])('renders %s accurately', (status, label) => {
  fixture.auth.result = { supported: true, health: { status, loginCommand: 'fixture login' } };
  view(); expect(screen.getByText(label)).toBeTruthy();
  const button = screen.queryByRole('button', { name: 'Sign in to Fixture' });
  if (status === 'unauthenticated' || status === 'expired') { fireEvent.click(button!); expect(fixture.start).toHaveBeenCalledOnce(); }
  else expect(button).toBeNull();
});
it('shows cancellation during startup, the interactive terminal, exit guidance and errors', () => {
  fixture.auth.starting = true;
  const rendered = view(); expect(screen.getByText('Starting sign-in on Selected machine…')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' })); expect(fixture.cancel).toHaveBeenCalledOnce();
  fixture.auth.starting = false; fixture.auth.session = { id: 'login', status: 'exited' }; fixture.auth.error = 'Retry close';
  rendered.rerender(<ProviderAuthentication providerId="fixture" name="Fixture" onReady={vi.fn()} />);
  expect(screen.getByTestId('login-terminal')).toBeTruthy(); expect(screen.getByText(/Sign-in terminal exited/)).toBeTruthy(); expect(screen.getByRole('alert').textContent).toBe('Retry close');
  fireEvent.click(screen.getByRole('button', { name: 'Close sign-in' })); expect(fixture.cancel).toHaveBeenCalledTimes(2);
});
it('disables disconnected checks and displays unsupported/checking states honestly', () => {
  const rendered = view(''); expect(screen.getByText('Machine disconnected')).toBeTruthy(); expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  fixture.auth.checking = true; fixture.auth.result = { supported: false };
  rendered.rerender(<ProviderAuthentication providerId="fixture" name="Fixture" hostId="h1" onReady={vi.fn()} />);
  expect(screen.getByText('Checking credentials…')).toBeTruthy();
});

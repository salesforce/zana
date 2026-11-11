// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ json: vi.fn(), copy: vi.fn() }));
vi.mock('../../lib/fetch-with-app-surface.js', () => ({ apiJson: api.json }));
vi.mock('../../lib/copy-text.js', () => ({ copyText: api.copy }));
import { GitAccessChecklist } from './GitAccessChecklist.js';

const HOST = 'git.example.test';
const profile = { id: 'employees', organization: 'Example', question: 'Q?', prerequisite: 'P', marketplaceSource: 'git:https://git.example.test/m.git',
  gitAuth: { host: HOST, method: 'gh-device' as const } };
const status = (patch: object = {}) => ({ host: HOST, reachable: true, cli: 'available', signedIn: 'no', ...patch });
const waiting = { phase: 'waiting', code: 'AB12-CD34', verificationUrl: `https://${HOST}/login/device`, expiresAt: Date.now() + 15 * 60_000 };

let routes: Record<string, unknown[]>;
const respond = (path: string, ...values: unknown[]) => { routes[path] = values; };
let connect: ReturnType<typeof vi.fn>;
let footer: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  routes = {};
  api.copy.mockResolvedValue(undefined);
  api.json.mockImplementation(async (path: string) => {
    const queue = routes[path];
    if (!queue?.length) throw new Error(`unexpected ${path}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return path.endsWith('/status') ? { status: next } : { state: next };
  });
  connect = vi.fn();
  footer = document.createElement('div');
  document.body.append(footer);
});
afterEach(() => { cleanup(); footer.remove(); vi.useRealTimers(); });

const mount = (onBusyChange = vi.fn()) => render(<GitAccessChecklist profile={profile} connect={connect} footerTarget={footer} onBusyChange={onBusyChange} />);
const check = () => fireEvent.click(screen.getByRole('button', { name: /Check access and continue|Retry access check/ }));

it('starts idle with the three checks and a footer action', () => {
  mount();
  expect(screen.getByText('Corporate network (VPN)')).toBeTruthy();
  expect(screen.getByText('Sign in to Git')).toBeTruthy();
  expect(screen.getByText('Marketplace access')).toBeTruthy();
  expect(footer.textContent).toContain('Check access and continue');
  expect(screen.getByText(profile.marketplaceSource)).toBeTruthy();
});

it('passes straight through when Git credentials already work', async () => {
  respond('/onboarding/git/status', status({ signedIn: 'yes', login: 'ada' }));
  connect.mockResolvedValue(undefined);
  const busy = vi.fn();
  mount(busy);
  check();
  await screen.findByText('Marketplace access confirmed');
  expect(screen.getByText('Connected to the corporate network')).toBeTruthy();
  expect(screen.getByText(`ada@${HOST}`)).toBeTruthy();
  expect(busy).toHaveBeenCalledWith(true);
  expect(busy).toHaveBeenLastCalledWith(false);
});

it('accepts existing non-gh credentials (SSH / credential manager) without asking to sign in', async () => {
  respond('/onboarding/git/status', status({ signedIn: 'no' }));
  connect.mockResolvedValue(undefined);
  mount();
  check();
  await screen.findByText('Signed in to Git');
  expect(screen.getByText('Your existing Git credentials work.')).toBeTruthy();
});

it('releases the navigation lock when connecting advances away from this step', async () => {
  respond('/onboarding/git/status', status({ signedIn: 'yes', login: 'ada' }));
  let finish!: () => void;
  connect.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const busy = vi.fn();
  const view = mount(busy);
  check();
  await waitFor(() => expect(connect).toHaveBeenCalledOnce());
  expect(busy).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(busy).toHaveBeenLastCalledWith(false);
  busy.mockClear();
  await act(async () => { finish(); });
  expect(busy).not.toHaveBeenCalled();
});

it('asks to connect the VPN when the host is unreachable, without cloning', async () => {
  respond('/onboarding/git/status', status({ reachable: false, signedIn: 'unknown' }));
  mount();
  check();
  await screen.findByText(`Can’t reach ${HOST}. Connect to the VPN, then retry.`);
  expect(connect).not.toHaveBeenCalled();
  expect(footer.textContent).toContain('Retry access check');
});

it('reports when the access check itself cannot run', async () => {
  respond('/onboarding/git/status', new Error('down'));
  mount();
  check();
  await screen.findByText('Could not run the access check. Try again.');
});

it('runs the browser device sign-in end to end, then retries the marketplace', async () => {
  respond('/onboarding/git/status', status(), status({ signedIn: 'yes', login: 'ada' }));
  connect.mockRejectedValueOnce(new Error('fatal: could not read Username')).mockResolvedValue(undefined);
  respond('/onboarding/git/sign-in/start', { phase: 'starting' });
  respond('/onboarding/git/sign-in', waiting, { phase: 'finishing' }, { phase: 'succeeded' });
  const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
  mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  expect(await screen.findByText('AB12-CD34', {}, { timeout: 3000 })).toBeTruthy();
  expect(screen.getByText(/Expires in 15 min/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  await screen.findByRole('button', { name: 'Copied' });
  expect(api.copy).toHaveBeenCalledWith('AB12-CD34');
  fireEvent.click(screen.getByRole('button', { name: `Open ${HOST}` }));
  expect(open).toHaveBeenCalledWith(`https://${HOST}/login/device`, '_blank', 'noopener');
  await screen.findByText('Marketplace access confirmed', {}, { timeout: 5000 });
  expect(screen.getByText(`ada@${HOST}`)).toBeTruthy();
  expect(connect).toHaveBeenCalledTimes(2);
  open.mockRestore();
});

it('offers a new code when the device code expires, and a retry when sign-in fails', async () => {
  respond('/onboarding/git/status', status());
  connect.mockRejectedValue(new Error('auth'));
  respond('/onboarding/git/sign-in/start', { phase: 'expired' });
  mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Get a new code' }));
  respond('/onboarding/git/sign-in/start', { phase: 'failed', error: 'error: access denied' });
  fireEvent.click(await screen.findByRole('button', { name: 'Get a new code' }));
  await screen.findByText('error: access denied');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

it('explains how to install the GitHub CLI when it is missing', async () => {
  respond('/onboarding/git/status', status({ cli: 'missing', signedIn: 'unknown' }));
  connect.mockRejectedValue(new Error('auth'));
  mount();
  check();
  await screen.findByText('brew install gh');
  respond('/onboarding/git/sign-in/start', { phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' });
  // A start that reports the CLI as missing lands on the same guidance.
  expect(screen.getByText('Browser sign-in needs the GitHub CLI, which isn’t installed.')).toBeTruthy();
});

it('maps a start-time missing CLI and a start request failure', async () => {
  respond('/onboarding/git/status', status());
  connect.mockRejectedValue(new Error('auth'));
  respond('/onboarding/git/sign-in/start', { phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' });
  mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  await screen.findByText('brew install gh');
  respond('/onboarding/git/sign-in/start', new Error('boom'));
  check();
  await screen.findByRole('button', { name: 'Sign in with browser' });
  // cli still reported available → sign in again; the start request itself fails.
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with browser' }));
  await screen.findByText('Could not start the browser sign-in.');
});

it('reports a download failure without claiming the signed-in account lacks permission and lets the user switch account', async () => {
  respond('/onboarding/git/status', status({ signedIn: 'yes', login: 'ada' }));
  connect.mockRejectedValue(new Error('remote: Repository not found.'));
  respond('/onboarding/git/sign-in/start', waiting);
  respond('/onboarding/git/sign-in', waiting);
  mount();
  check();
  await screen.findByText('Signed in as ada, but the marketplace download failed.');
  expect(screen.queryByText(/Ask your marketplace administrator/)).toBeNull();
  expect(screen.getByText('Could not access the repository')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
  await screen.findByText('AB12-CD34');
});

it.each([
  ['Could not connect to the Git server. Check your network or VPN.', 'Could not connect to the Git server'],
  ['Git certificate verification failed.', 'Could not verify the Git server’s certificate'],
  ['Plugin source command timed out', 'The clone timed out'],
  ['git clone failed', 'Could not clone the repository']
])('shows the actual failure category for an existing login: %s', async (message, title) => {
  respond('/onboarding/git/status', status({ signedIn: 'yes', login: 'ada' }));
  connect.mockRejectedValue(new Error(message));
  mount();
  check();
  await screen.findByText(title);
  expect(screen.queryByText(/this account can’t read/)).toBeNull();
  expect(screen.queryByText(/Ask your marketplace administrator/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry access check' })).toBeTruthy();
});

it('cancels an in-flight sign-in from the row and when the step unmounts', async () => {
  respond('/onboarding/git/status', status());
  connect.mockRejectedValue(new Error('auth'));
  respond('/onboarding/git/sign-in/start', waiting);
  respond('/onboarding/git/sign-in', waiting);
  respond('/onboarding/git/sign-in/cancel', { phase: 'idle' });
  const view = mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  await screen.findByText('AB12-CD34');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('button', { name: 'Sign in with browser' });
  expect(api.json).toHaveBeenCalledWith('/onboarding/git/sign-in/cancel', expect.objectContaining({ method: 'POST' }));
  api.json.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with browser' }));
  await screen.findByText('AB12-CD34');
  view.unmount();
  await waitFor(() => expect(api.json).toHaveBeenCalledWith('/onboarding/git/sign-in/cancel', expect.objectContaining({ method: 'POST' })));
});

it('recovers when polling loses the sign-in', async () => {
  respond('/onboarding/git/status', status());
  connect.mockRejectedValue(new Error('auth'));
  respond('/onboarding/git/sign-in/start', { phase: 'starting' });
  respond('/onboarding/git/sign-in', new Error('gone'));
  mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  await screen.findByText('Lost track of the sign-in. Try again.', {}, { timeout: 3000 });
});

it('returns to sign-in when the server reports idle', async () => {
  respond('/onboarding/git/status', status());
  connect.mockRejectedValue(new Error('auth'));
  respond('/onboarding/git/sign-in/start', { phase: 'idle' });
  mount();
  check();
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in with browser' }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('button', { name: 'Sign in with browser' })).toBeTruthy();
});

it('renders without a footer target', () => {
  render(<GitAccessChecklist profile={profile} connect={connect} footerTarget={null} />);
  expect(footer.textContent).toBe('');
});

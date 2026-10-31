// @vitest-environment happy-dom
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { PromptContextBanner as ContextBanner } from './ComposerStackCards.js';
import { useLiveThreadContext } from '../useLiveThreadContext.js';

// Exercise the shared live value with its real composer presentation.
function PromptContextBanner(props: ComponentProps<typeof ContextBanner> & { environmentId?: string | null }) {
  const { displayedBranch, pullRequest } = useLiveThreadContext(props);
  return <ContextBanner {...props} branchName={displayedBranch} pullRequest={pullRequest} />;
}

const api = vi.hoisted(() => ({ status: vi.fn(), pullRequest: vi.fn(), handleHttpLinkClick: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { environments: api } }));
vi.mock('../../../lib/in-app-browser-link-preference.js', () => ({ handleHttpLinkClick: api.handleHttpLinkClick }));
vi.mock('../../../store.js', () => ({ useUi: { getState: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function settle() { await act(async () => {}); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(3_000); }); }
const banner = () => screen.queryByTestId('thread-prompt-context');
const pr = { number: 42, url: 'https://example.test/pr/42' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.status.mockResolvedValue({ branchName: 'live' });
  api.pullRequest.mockResolvedValue({ pullRequest: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('replaces stored metadata with the live branch and follows later switches without remounting', async () => {
  const { rerender } = render(<PromptContextBanner threadId="t" environmentId="remote-env" branchName="stored" />);
  expect(banner()?.textContent).toContain('git: stored');
  await settle();
  expect(banner()?.textContent).toBe('git: live');
  expect(api.status).toHaveBeenCalledWith('remote-env');
  api.status.mockResolvedValue({ branchName: 'switched' });
  await tick();
  expect(banner()?.textContent).toBe('git: switched');
  rerender(<PromptContextBanner threadId="t" environmentId="remote-env" branchName="stored-again" />);
  expect(banner()?.textContent).toBe('git: switched');
});

it('clears a stored branch on successful detached or non-repository status', async () => {
  render(<PromptContextBanner environmentId="env" branchName="stored" />);
  await settle();
  api.status.mockResolvedValue({ branchName: null });
  await tick();
  expect(banner()).toBeNull();
  api.status.mockResolvedValue({ branchName: 'reattached' });
  await tick();
  expect(banner()?.textContent).toBe('git: reattached');
});

it('keeps the fallback on initial failure, then preserves the last live branch during errors and recovers', async () => {
  api.status.mockRejectedValue(new Error('offline'));
  render(<PromptContextBanner environmentId="env" branchName="stored" />);
  await settle();
  expect(banner()?.textContent).toBe('git: stored');
  api.status.mockResolvedValue({ branchName: 'live' });
  await tick();
  expect(banner()?.textContent).toBe('git: live');
  api.status.mockRejectedValue(new Error('offline'));
  await tick();
  expect(banner()?.textContent).toBe('git: live');
  api.status.mockResolvedValue({ branchName: 'recovered' });
  await tick();
  expect(banner()?.textContent).toBe('git: recovered');
});

it('refreshes branches independently of a slow PR and bounds pending PR requests', async () => {
  const pendingPr = deferred<{ pullRequest: typeof pr | null }>();
  api.pullRequest.mockReturnValue(pendingPr.promise);
  render(<PromptContextBanner environmentId="env" branchName="stored" />);
  await settle();
  expect(banner()?.textContent).toBe('git: live');
  api.status.mockResolvedValue({ branchName: 'switched' });
  await tick();
  await tick();
  expect(banner()?.textContent).toBe('git: switched');
  expect(api.pullRequest).toHaveBeenCalledTimes(1);
  await act(async () => { pendingPr.resolve({ pullRequest: pr }); });
  expect(screen.getByRole('link', { name: 'PR #42' }).getAttribute('href')).toBe(pr.url);
});

it('recovers PR polling after failure without blocking branch updates', async () => {
  api.pullRequest.mockRejectedValue(new Error('no PR'));
  render(<PromptContextBanner environmentId="env" branchName="stored" />);
  await settle();
  expect(banner()?.textContent).toBe('git: live');
  expect(screen.queryByRole('link')).toBeNull();
  api.pullRequest.mockResolvedValue({ pullRequest: pr });
  await tick();
  expect(screen.getByRole('link', { name: 'PR #42' })).toBeTruthy();
  api.pullRequest.mockRejectedValue(new Error('offline'));
  await tick();
  expect(screen.queryByRole('link')).toBeNull();
  expect(banner()?.textContent).toBe('git: live');
});

it.each([
  { threadId: 'new-thread', environmentId: 'env' },
  { threadId: 't', environmentId: 'new-env' }
])('rejects late responses when identity changes to %j', async (next) => {
  const oldStatus = deferred<{ branchName: string }>();
  const oldPr = deferred<{ pullRequest: typeof pr }>();
  api.status.mockReturnValueOnce(oldStatus.promise).mockResolvedValue({ branchName: 'new-live' });
  api.pullRequest.mockReturnValueOnce(oldPr.promise).mockResolvedValue({ pullRequest: null });
  const { rerender } = render(<PromptContextBanner threadId="t" environmentId="env" branchName="old" />);
  rerender(<PromptContextBanner {...next} branchName="new-stored" />);
  expect(banner()?.textContent).toBe('git: new-stored');
  await settle();
  expect(banner()?.textContent).toBe('git: new-live');
  await act(async () => { oldStatus.resolve({ branchName: 'old-live' }); oldPr.resolve({ pullRequest: pr }); });
  expect(banner()?.textContent).toBe('git: new-live');
  expect(screen.queryByRole('link')).toBeNull();
});

it('does not leak a resolved branch or PR into a new environment or a thread without one', async () => {
  api.pullRequest.mockResolvedValue({ pullRequest: pr });
  const { rerender } = render(<PromptContextBanner threadId="t" environmentId="env" branchName="stored" />);
  await settle();
  expect(banner()?.textContent).toContain('git: live');
  api.status.mockReturnValue(new Promise(() => {}));
  api.pullRequest.mockReturnValue(new Promise(() => {}));
  rerender(<PromptContextBanner threadId="t" environmentId="next" branchName="next-stored" />);
  expect(banner()?.textContent).toBe('git: next-stored');
  expect(screen.queryByRole('link')).toBeNull();
  rerender(<PromptContextBanner threadId="t" branchName="no-environment" />);
  expect(banner()?.textContent).toBe('git: no-environment');
  await tick();
  expect(api.status).toHaveBeenCalledTimes(2);
});

it('bounds pending status requests and stops polling on unmount', async () => {
  const pending = deferred<{ branchName: string }>();
  api.status.mockReturnValue(pending.promise);
  const { unmount } = render(<PromptContextBanner environmentId="env" branchName="stored" />);
  await tick();
  await tick();
  expect(api.status).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ branchName: 'settled' }); });
  expect(banner()?.textContent).toBe('git: settled');
  unmount();
  await tick();
  expect(api.status).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores status and PR responses after unmount', async () => {
  const status = deferred<{ branchName: string }>();
  const pullRequest = deferred<{ pullRequest: typeof pr }>();
  api.status.mockReturnValue(status.promise);
  api.pullRequest.mockReturnValue(pullRequest.promise);
  const { unmount } = render(<PromptContextBanner environmentId="env" />);
  unmount();
  await act(async () => { status.resolve({ branchName: 'late' }); pullRequest.resolve({ pullRequest: pr }); });
  expect(banner()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps worktree, fork, child-count and PR context when the live branch is null', async () => {
  api.status.mockResolvedValue({ branchName: null });
  api.pullRequest.mockResolvedValue({ pullRequest: pr });
  render(<PromptContextBanner threadId="t" environmentId="env" branchName="stored" isWorktree originKind="fork" parentThreadId="parent" childCount={2} />);
  await settle();
  expect(banner()?.textContent).toBe('worktree · fork · 2 child agentsPR #42');
  api.handleHttpLinkClick.mockReturnValue(true);
  const link = screen.getByRole('link');
  const shiftClick = createEvent.click(link, { shiftKey: true });
  fireEvent(link, shiftClick);
  expect(shiftClick.defaultPrevented).toBe(false);
  const altClick = createEvent.click(link, { altKey: true });
  fireEvent(link, altClick);
  expect(altClick.defaultPrevented).toBe(false);
  expect(api.handleHttpLinkClick).not.toHaveBeenCalled();
  const handledClick = createEvent.click(link);
  fireEvent(link, handledClick);
  expect(api.handleHttpLinkClick).toHaveBeenCalledWith(pr.url, expect.objectContaining({ ownerId: 't' }));
  expect(handledClick.defaultPrevented).toBe(true);
  api.handleHttpLinkClick.mockReturnValue(false);
  let defaultPreventedInFallback: boolean | undefined;
  const preventNavigation = (event: Event) => {
    defaultPreventedInFallback = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('click', preventNavigation);
  fireEvent.click(link);
  window.removeEventListener('click', preventNavigation);
  expect(defaultPreventedInFallback).toBe(false);
});

it('renders recorded metadata and child context without an environment and makes no requests', async () => {
  const { rerender } = render(<PromptContextBanner branchName="stored" parentThreadId="parent" childCount={1} />);
  await tick();
  expect(banner()?.textContent).toBe('git: stored · child thread · 1 child agent');
  expect(api.status).not.toHaveBeenCalled();
  expect(api.pullRequest).not.toHaveBeenCalled();
  rerender(<PromptContextBanner />);
  expect(banner()).toBeNull();
});

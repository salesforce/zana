// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginPackCards, PluginPackForgetConfirm, PluginPackReview, type PluginPackCardModel, type PluginPackReviewModel } from './PluginPacks.js';

const pack: PluginPackCardModel = { key: 'catalog:starter', id: 'starter', title: 'Team essentials', description: 'Connect accounts and developer environments.', marketplace: 'Internal', memberNames: ['Account bridge', 'Environment tools'], installedCount: 1, memberCount: 2, remembered: false };
const review: PluginPackReviewModel = { pack, members: [
  { id: 'accounts', title: 'Account bridge', description: 'Work accounts.', source: 'git:trusted/accounts@v1', author: 'Team', version: '1.0', permissions: ['network'], optional: false, installed: true, available: true },
  { id: 'environments', title: 'Environment tools', description: 'Your environments.', source: 'git:trusted/environments@v2', optional: true, installed: false, available: true }
] };
afterEach(cleanup);
it('renders no empty packs section and presents pack membership without installing from the card', () => {
  const onReview = vi.fn(), onForget = vi.fn();
  const view = render(<PluginPackCards packs={[]} mode="browse" onReview={onReview} onForget={onForget} />);
  expect(screen.queryByRole('region')).toBeNull();
  view.rerender(<PluginPackCards packs={[pack]} mode="browse" onReview={onReview} onForget={onForget} />);
  expect(screen.getByRole('region', { name: 'Plugin packs' })).toBeTruthy();
  expect(screen.getByText('1 of 2 plugins installed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Review pack' }).classList.contains('primary')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Review pack' }));
  expect(onReview).toHaveBeenCalledWith(pack);
  expect(onForget).not.toHaveBeenCalled();
});
it('shows compact installed management and limits membership chips for large packs', () => {
  const onReview = vi.fn(), onForget = vi.fn();
  const larger = { ...pack, memberNames: ['One', 'Two', 'Three', 'Four'] };
  render(<PluginPackCards packs={[larger]} mode="installed" onReview={onReview} onForget={onForget} />);
  expect(screen.getByRole('region', { name: 'Installed plugin packs' })).toBeTruthy();
  expect(screen.getByText('+1 more')).toBeTruthy();
  expect(screen.queryByText('Four')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Manage pack' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forget pack' }));
  expect(onReview).toHaveBeenCalledWith(larger); expect(onForget).toHaveBeenCalledWith(larger);
});
it('reviews individual publishers and sources, preserves existing plugins and respects optional choices', () => {
  const onInstall = vi.fn(), onOpenPlugin = vi.fn(), onClose = vi.fn();
  render(<PluginPackReview review={review} onInstall={onInstall} onClose={onClose} onOpenPlugin={onOpenPlugin} />);
  expect(screen.getByText('Team · v1.0 · git:trusted/accounts@v1')).toBeTruthy();
  expect(screen.getByText('Capabilities: network')).toBeTruthy();
  expect(screen.getByText(/full trust/)).toBeTruthy();
  expect(screen.queryByLabelText('Include Account bridge')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' })); expect(onOpenPlugin).toHaveBeenCalledWith('accounts');
  fireEvent.click(screen.getByLabelText('Include Environment tools'));
  expect(screen.getByText('1 already installed · 0 to install')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save pack' })); expect(onInstall).toHaveBeenLastCalledWith(['accounts']);
  fireEvent.click(screen.getByLabelText('Include Environment tools'));
  fireEvent.click(screen.getByRole('button', { name: 'Install selected plugins' })); expect(onInstall).toHaveBeenLastCalledWith(['accounts', 'environments']);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onClose).toHaveBeenCalledOnce();
});
it('enforces required selections and blocks install when a required member is unavailable', () => {
  const target = { ...review, members: [{ ...review.members[1]!, optional: false, available: false, error: 'Not in this marketplace' }] };
  render(<PluginPackReview review={target} onInstall={vi.fn()} onClose={vi.fn()} onOpenPlugin={vi.fn()} />);
  const checkbox = screen.getByLabelText('Include Environment tools') as HTMLInputElement;
  expect(checkbox.checked).toBe(false); expect(checkbox.disabled).toBe(true);
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Not in this marketplace');
  expect((screen.getByRole('button', { name: 'Save pack' }) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps the review open and disables selections, dismissal and settings during install', () => {
  const onClose = vi.fn();
  render(<PluginPackReview review={review} busy onInstall={vi.fn()} onClose={onClose} onOpenPlugin={vi.fn()} />);
  expect((screen.getByLabelText('Include Environment tools') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Installing…' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Open settings' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  expect(onClose).not.toHaveBeenCalled();
});
it('retries only failed members while showing success and skipped results', () => {
  const onInstall = vi.fn();
  const target = { ...review, members: [...review.members,
    { ...review.members[1]!, id: 'other', title: 'Other tools' },
    { ...review.members[1]!, id: 'optional', title: 'Skipped tools' }
  ] };
  render(<PluginPackReview review={target} results={[
    { id: 'environments', status: 'installed' }, { id: 'other', status: 'failed', error: 'Connection interrupted' }, { id: 'optional', status: 'skipped' }
  ]} error="One plugin could not be installed." onInstall={onInstall} onClose={vi.fn()} onOpenPlugin={vi.fn()} />);
  expect(within(screen.getByTestId('plugin-pack-member-environments')).getByText('Installed')).toBeTruthy();
  expect(screen.getByText('Skipped')).toBeTruthy();
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed plugins' }));
  expect(onInstall).toHaveBeenCalledWith(['other']);
});
it('shows completion and offers settings without another installation', () => {
  const onClose = vi.fn();
  render(<PluginPackReview review={review} results={[{ id: 'accounts', status: 'already-installed' }, { id: 'environments', status: 'installed' }]} onInstall={vi.fn()} onClose={onClose} onOpenPlugin={vi.fn()} />);
  expect(screen.getByText('Pack saved. Manage each plugin below.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install selected plugins' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Open settings' })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Done' })); expect(onClose).toHaveBeenCalledOnce();
});
it('confirms forgetting separately, explains plugin preservation, and shows action errors', () => {
  const onForget = vi.fn(), onClose = vi.fn();
  const view = render(<PluginPackForgetConfirm pack={pack} error="Storage unavailable" onClose={onClose} onForget={onForget} />);
  expect(screen.getByText(/Its plugins stay installed/)).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('Storage unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Forget pack' })); expect(onForget).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<PluginPackForgetConfirm pack={pack} busy onClose={onClose} onForget={onForget} />);
  expect((screen.getByRole('button', { name: 'Forgetting…' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
});
it('does not submit an empty pack selection', () => {
  render(<PluginPackReview review={{ ...review, members: [review.members[1]!] }} onInstall={vi.fn()} onClose={vi.fn()} onOpenPlugin={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Include Environment tools'));
  expect((screen.getByRole('button', { name: 'Save pack' }) as HTMLButtonElement).disabled).toBe(true);
});

it('renders a pending result as progress without failure or completion', () => {
  render(<PluginPackReview review={review} results={[{ id: 'accounts', status: 'installed' }, { id: 'environments', status: 'pending' }]} onInstall={vi.fn()} onClose={vi.fn()} onOpenPlugin={vi.fn()} />);
  expect(within(screen.getByTestId('plugin-pack-member-environments')).getByText('Installing…')).toBeTruthy();
  expect(screen.getByText('Installing selected plugins…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Installing…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Failed')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('does not announce completion from an intermediate all-installed poll while the install request is active', () => {
  render(<PluginPackReview review={review} busy results={[{ id: 'accounts', status: 'installed' }, { id: 'environments', status: 'installed' }]} onInstall={vi.fn()} onClose={vi.fn()} onOpenPlugin={vi.fn()} />);
  expect(screen.getByText('Installing selected plugins…')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByText('Pack saved. Manage each plugin below.')).toBeNull();
});

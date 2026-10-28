// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { TabBar } from './TabBar';
import { useData } from '../store.js';

const realConfirm = window.confirm;

const tab = (over: Partial<TerminalSession>) =>
  ({ id: 't1', projectId: 'p1', title: 'Review', status: 'running', profile: 'claude', ...over }) as unknown as TerminalSession;

function open(t: TerminalSession, onClose = vi.fn()) {
  render(<TabBar projectId="p1" tabs={[t]} activeTabId={t.id} onSelect={() => {}} onClose={onClose} onNewTerminal={() => {}} />);
  fireEvent.contextMenu(screen.getByText(t.title));
  return onClose;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel' });
  useData.setState({ projects: [{ id: 'p1', name: 'P', path: '/tmp' }] as never });
});
afterEach(() => { cleanup(); window.confirm = realConfirm; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('TabBar Archive wording', () => {
  it('shows Archive with the History tooltip for a live agent tab, and no Delete', () => {
    open(tab({}));
    expect(screen.getByRole('button', { name: 'Archive' }).getAttribute('title')).toBe(
      'Stop the agent and remove the tab. Its conversation stays in History.'
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('uses neutral wording for a harness without History and for a remote project', () => {
    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    open(tab({ profile: 'mastracode' }));
    expect(screen.getByRole('button', { name: 'Archive' }).getAttribute('title')).toBe(
      'Stop the agent and remove the tab.'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(confirm).toHaveBeenCalledWith('Archive “Review”? The agent stops and is removed from the board.');
    cleanup();
    useData.setState({ projects: [{ id: 'p1', name: 'P', path: '/tmp', remote: { host: 'h' } }] as never });
    open(tab({}));
    expect(screen.getByRole('button', { name: 'Archive' }).getAttribute('title')).toBe(
      'Stop the agent and remove the tab.'
    );
  });

  it('points the X tooltip at Archive', () => {
    open(tab({}));
    expect(screen.getByLabelText('Close Review').getAttribute('title')).toMatch(/Right-click → Archive to end it\.$/);
  });

  it('does not close when the Archive confirm is declined, and closes once when accepted', () => {
    const confirm = vi.fn(() => false);
    window.confirm = confirm;
    const onClose = open(tab({}));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(confirm).toHaveBeenCalledWith('Archive “Review”? The agent stops and its conversation stays in History.');
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.contextMenu(screen.getByText('Review'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('t1');
  });

  it('keeps Delete for a live plain shell', () => {
    open(tab({ profile: 'shell', title: 'zsh' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.getByLabelText('Close zsh').getAttribute('title')).toMatch(/Right-click → Delete to end it\.$/);
  });

  it('keeps Dismiss for an exited agent tab', () => {
    open(tab({ status: 'exited' }));
    // the Close item reads Dismiss for an exited tab too; the remove item is the danger one
    expect(screen.getAllByRole('button', { name: 'Dismiss' }).some((b) => b.className.includes('tab-context-danger'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });
});

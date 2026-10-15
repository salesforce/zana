// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { HostInstallDrawer, HostInstallDrawerView } from '../HostInstallDrawer.js';
import { EMPTY_HOST_INSTALL_DRAWER, HOST_INSTALL_SUCCESS_CLOSE_MS } from '../../lib/host-install-drawer.js';
import { useUi } from '../../store.js';
import { copyText } from '../../lib/copy-text.js';
import { runHostInstallWithDrawer } from '../../lib/host-install-run.js';

vi.mock('../../lib/copy-text.js', () => ({ copyText: vi.fn() }));
beforeEach(() => useUi.setState({ hostInstallDrawer: EMPTY_HOST_INSTALL_DRAWER }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('HostInstallDrawerView', () => {
  it('renders live logs, the failure, and a copy-command footer', () => {
    const html = renderToStaticMarkup(
      <HostInstallDrawerView
        busy={false}
        kind="install"
        target="limited-pony"
        logs={['Installing host daemon over SSH…', 'host daemon did not report connected']}
        error="The host daemon started but never connected back. Retry, or copy the SSH command."
        pairingCommand="ssh -R 18782:127.0.0.1:8780 limited-pony 'curl …'"
        onClose={vi.fn()}
        onCopyPairing={vi.fn()}
      />
    );
    expect(html).toContain('data-testid="host-install-drawer"');
    expect(html).toContain('Install failed');
    expect(html).toContain('limited-pony');
    expect(html).toContain('host daemon did not report connected');
    expect(html).toContain('never connected back');
    expect(html).toContain('Copy install command');
    expect(html).toContain('quick-access-panel host-install-drawer');
    expect(html).toContain('Remote daemon · limited-pony');
    expect(html).toContain('role="alert"');
  });

  it('sits beside the notifications drawer in the shell', () => {
    const app = readFileSync(new NodeURL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('<HostInstallDrawer />');
    expect(app).toContain('<NotificationsDrawer />');
  });

  it('shows a waiting state and supports close and Escape without closing on other keys', () => {
    const onClose = vi.fn();
    const view = render(<HostInstallDrawerView busy kind="install" target={null} logs={[]}
      error={null} pairingCommand={null} onClose={onClose} />);
    expect(screen.getByText('Waiting for install output')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Installing…');
    expect(screen.queryByTestId('host-install-copy-command')).toBeNull();
    const close = screen.getByRole('button', { name: 'Close install log' });
    fireEvent.keyDown(close, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(close, { key: 'Escape' });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(2);
    view.rerender(<HostInstallDrawerView busy={false} kind="install" target={null} logs={[]}
      error="Permission denied" pairingCommand="ssh box" onClose={onClose} />);
    expect(screen.getByRole('alert').textContent).toBe('Permission denied');
    expect(screen.queryByTestId('host-install-log')).toBeNull();
    expect(screen.queryByTestId('host-install-copy-command')).toBeNull();
  });

  it('follows appended output and copies the command through the shell action', () => {
    useUi.getState().openHostInstallDrawer({ kind: 'fix', target: 'remote-box' });
    const view = render(<HostInstallDrawer />);
    act(() => useUi.getState().appendHostInstallLogs(['Checking remote daemon…']));
    const log = screen.getByTestId('host-install-log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 200 });
    act(() => useUi.getState().appendHostInstallLogs(['Permission denied']));
    expect(log.scrollTop).toBe(200);
    act(() => useUi.getState().finishHostInstallDrawer({ ok: false, message: 'Permission denied', pairingCommand: 'ssh remote-box' }));
    fireEvent.click(screen.getByTestId('host-install-copy-command'));
    expect(copyText).toHaveBeenCalledWith('ssh remote-box');
    fireEvent.click(screen.getByRole('button', { name: 'Close install log' }));
    expect(screen.queryByTestId('host-install-drawer')).toBeNull();
    view.unmount();
  });

  it('auto-closes success, leaves failure open and keeps reopened successful logs available', () => {
    vi.useFakeTimers();
    useUi.getState().openHostInstallDrawer({ kind: 'fix', target: 'remote-box' });
    render(<HostInstallDrawer />);
    act(() => useUi.getState().finishHostInstallDrawer({ ok: true }));
    expect(screen.getByRole('status').textContent).toBe('Reconnected');
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.queryByTestId('host-install-drawer')).toBeNull();
    act(() => useUi.getState().setHostInstallDrawerOpen(true));
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.getByTestId('host-install-drawer')).toBeTruthy();
    act(() => useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'remote-box' }));
    act(() => useUi.getState().finishHostInstallDrawer({ ok: false, message: 'Permission denied' }));
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.getByRole('alert').textContent).toBe('Permission denied');
  });

  it('stays open after success while the user has the log expanded, and auto-closes again once reopened', () => {
    vi.useFakeTimers();
    useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'remote-box' });
    useUi.setState((s) => ({ hostInstallDrawer: { ...s.hostInstallDrawer, logs: ['connecting'], stages: [{ stage: 'ssh', status: 'running' }] } }));
    render(<HostInstallDrawer />);
    act(() => { screen.getByTestId('host-install-log-toggle').click(); });
    act(() => useUi.getState().finishHostInstallDrawer({ ok: true }));
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.getByTestId('host-install-log').textContent).toContain('connecting');
    act(() => { screen.getByTestId('host-install-log-toggle').click(); });
    act(() => useUi.getState().setHostInstallDrawerOpen(false));
    act(() => useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'remote-box' }));
    act(() => useUi.getState().finishHostInstallDrawer({ ok: true }));
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.queryByTestId('host-install-drawer')).toBeNull();
  });

  it('cleans up the success timer if another installation starts or the panel unmounts', () => {
    vi.useFakeTimers();
    useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'first' });
    const view = render(<HostInstallDrawer />);
    act(() => useUi.getState().finishHostInstallDrawer({ ok: true }));
    act(() => useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'second' }));
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(screen.getByRole('status').textContent).toBe('Installing…');
    act(() => useUi.getState().finishHostInstallDrawer({ ok: true }));
    view.unmount();
    act(() => vi.advanceTimersByTime(HOST_INSTALL_SUCCESS_CLOSE_MS));
    expect(useUi.getState().hostInstallDrawer.open).toBe(true);
  });

  it('renders stage events with the log collapsed by default and toggleable', () => {
    useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'box' });
    render(<HostInstallDrawer />);
    expect(screen.queryByTestId('host-install-stages')).toBeNull();
    act(() => useUi.getState().applyHostInstallEvent({ type: 'stage', stage: 'ssh', status: 'running', limitMs: 30_000 }));
    act(() => useUi.getState().appendHostInstallLogs(['hello log']));
    expect(screen.getByTestId('host-install-stage-ssh')).toBeTruthy();
    expect(screen.queryByTestId('host-install-log')).toBeNull();
    fireEvent.click(screen.getByTestId('host-install-log-toggle'));
    expect(screen.getByTestId('host-install-log').textContent).toBe('hello log');
    fireEvent.click(screen.getByTestId('host-install-log-toggle'));
    expect(screen.queryByTestId('host-install-log')).toBeNull();
  });

  it('shows no Retry while busy, then Retry on failure re-runs the bootstrap', async () => {
    const run = vi.fn(async (onEvent: (e: import('@zana-ai/zcc-desktop-contract').HostBootstrapEvent) => void) => {
      onEvent({ type: 'stage', stage: 'ssh', status: 'failed', reason: 'Permission denied' });
      onEvent({ type: 'error', code: 'ssh_failed', message: 'Permission denied' });
      return [{ type: 'error', code: 'ssh_failed', message: 'Permission denied' }] as never;
    });
    render(<HostInstallDrawer />);
    await act(async () => { await runHostInstallWithDrawer({ kind: 'install', target: 'box', run }); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('host-install-stage-reason-ssh').textContent).toBe('Permission denied');
    await act(async () => { fireEvent.click(screen.getByTestId('host-install-retry')); });
    expect(run).toHaveBeenCalledTimes(2);
    expect(useUi.getState().hostInstallDrawer.stages).toHaveLength(1);
  });

  it('hides Retry while busy and swallows a rejected retry', async () => {
    useUi.getState().openHostInstallDrawer({ kind: 'install', target: 'box' });
    const view = render(<HostInstallDrawer />);
    act(() => useUi.getState().applyHostInstallEvent({ type: 'stage', stage: 'ssh', status: 'failed', reason: 'x' }));
    expect(screen.queryByTestId('host-install-retry')).toBeNull();
    const reject = vi.fn(async () => { throw new Error('boom'); });
    await act(async () => { await runHostInstallWithDrawer({ kind: 'install', target: 'box', run: reject }).catch(() => {}); });
    act(() => useUi.getState().applyHostInstallEvent({ type: 'stage', stage: 'ssh', status: 'failed', reason: 'x' }));
    await act(async () => { fireEvent.click(screen.getByTestId('host-install-retry')); });
    expect(reject).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});

describe('host install drawer stacking', () => {
  const css = readFileSync(new NodeURL('../../styles/global.css', import.meta.url), 'utf8');
  const zIndex = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const match = /z-index:\s*(\d+)/.exec(css.slice(start, css.indexOf('}', start)));
    return Number(match?.[1]);
  };

  it('stacks above the launcher backdrop so stages, Show log, and Retry stay clickable from the composer', () => {
    const drawer = zIndex('.quick-access-panel.quick-access-panel.host-install-drawer');
    expect(drawer).toBeGreaterThan(zIndex('.palette-backdrop'));
    expect(drawer).toBeLessThan(zIndex('.toaster'));
  });
});

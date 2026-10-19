// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ checkRemoteLogin: vi.fn(), join: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ peerConnections: api }));

import { JoinComputer } from './JoinComputer';

const ID = '22222222-2222-4222-8222-222222222222';
const base = { invitationId: ID, role: 'redeemer', state: 'redeeming', expiresAt: 1, awaitingApproval: false };

beforeEach(() => { api.checkRemoteLogin.mockReset(); api.join.mockReset().mockResolvedValue(base); });
afterEach(cleanup);

describe('JoinComputer', () => {
  it('trims the pasted token, joins, and never checks Remote Login', async () => {
    const onChange = vi.fn();
    render(<JoinComputer connections={[]} onChange={onChange} />);
    const join = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: '  tok-1 \n' } });
    fireEvent.click(join);
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('tok-1'));
    expect(await screen.findByText(/Status: redeeming/)).toBeTruthy();
    expect(onChange).toHaveBeenCalled();
    expect(api.checkRemoteLogin).not.toHaveBeenCalled();
  });

  it('prefills from a link but never joins until the user presses Join', async () => {
    render(<JoinComputer connections={[]} initialToken="tok-link" />);
    expect((screen.getByLabelText(/Invitation/) as HTMLTextAreaElement).value).toBe('tok-link');
    expect(screen.getByText(/Filled in from a link/)).toBeTruthy();
    expect(api.join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('tok-link'));
  });

  it('shows the pairing code large with the connects-out note', async () => {
    const withCode = { ...base, state: 'reserved', pairingCode: 'ABCD-1234' } as never;
    render(<JoinComputer connections={[]} />);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Status/);
    cleanup();
    api.join.mockResolvedValue(withCode);
    const view = render(<JoinComputer connections={[]} />);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('ABCD-1234');
    expect(screen.getByText('Tell the other computer this code.')).toBeTruthy();
    expect(screen.getByText('This computer connects out to the other one; Remote Login is not needed here.')).toBeTruthy();
    view.unmount();
    expect(api.checkRemoteLogin).not.toHaveBeenCalled();
  });

  it('prefers the polled connection (pairing code arrives later)', async () => {
    const { rerender } = render(<JoinComputer connections={[]} />);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Status/);
    rerender(<JoinComputer connections={[{ ...base, state: 'reserved', pairingCode: 'WXYZ-2345' } as never]} />);
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('WXYZ-2345');
  });

  it('shows the failure reason when no code', async () => {
    api.join.mockResolvedValue({ ...base, state: 'failed', reason: 'expired' });
    const onClose = vi.fn();
    render(<JoinComputer connections={[]} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('expired')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces join errors', async () => {
    api.join.mockRejectedValueOnce(new Error('invalid invitation'));
    render(<JoinComputer connections={[]} />);
    fireEvent.change(screen.getByLabelText(/Invitation/), { target: { value: 'tok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByRole('alert')).textContent).toBe('invalid invitation');
    api.join.mockRejectedValueOnce('x');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Request failed'));
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ checkRemoteLogin: vi.fn(), join: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ peerConnections: api }));

import { JoinComputer } from './JoinComputer';

const ID = '22222222-2222-4222-8222-222222222222';
const base = { invitationId: ID, role: 'redeemer', state: 'redeeming', expiresAt: 1, awaitingApproval: false };

/** Fill both the token and the approval code; the Join button stays disabled until both are present. */
function fill(token: string, code = 'ABCD-EFGH') {
  fireEvent.change(screen.getByLabelText('Invitation'), { target: { value: token } });
  fireEvent.change(screen.getByLabelText('Approval code'), { target: { value: code } });
}

beforeEach(() => { api.checkRemoteLogin.mockReset(); api.join.mockReset().mockResolvedValue(base); });
afterEach(cleanup);

describe('JoinComputer', () => {
  it('trims the pasted token, joins, and never checks Remote Login', async () => {
    const onChange = vi.fn();
    render(<JoinComputer connections={[]} onChange={onChange} />);
    const join = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    // Token alone is not enough: the approval code is required too.
    fireEvent.change(screen.getByLabelText('Invitation'), { target: { value: '  tok-1 \n' } });
    expect(join.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Approval code'), { target: { value: ' ABCD-EFGH ' } });
    expect(join.disabled).toBe(false);
    fireEvent.click(join);
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('tok-1', 'ABCD-EFGH'));
    expect(await screen.findByText(/Your approval code will appear here/)).toBeTruthy();
    expect(onChange).toHaveBeenCalled();
    expect(api.checkRemoteLogin).not.toHaveBeenCalled();
  });

  it('shows the pairing code large with instructions to finish connecting', async () => {
    const withCode = { ...base, state: 'reserved', pairingCode: 'ABCD-1234' } as never;
    render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Your approval code will appear here/);
    cleanup();
    api.join.mockResolvedValue(withCode);
    const view = render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('ABCD-1234');
    expect(screen.getByText('Enter this code on the other computer to finish connecting.')).toBeTruthy();
    expect(screen.queryByText(/Remote Login is not needed/)).toBeNull();
    view.unmount();
    expect(api.checkRemoteLogin).not.toHaveBeenCalled();
  });

  it('prefers the polled connection (pairing code arrives later)', async () => {
    const { rerender } = render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Your approval code will appear here/);
    const code = screen.getByTestId('pairing-code');
    expect(code.textContent).toBe('---- ----');
    expect(code.getAttribute('aria-busy')).toBe('true');
    rerender(<JoinComputer connections={[{ ...base, state: 'reserved', pairingCode: 'WXYZ-2345' } as never]} />);
    expect((await screen.findByTestId('pairing-code')).textContent).toBe('WXYZ-2345');
    expect(screen.getByTestId('pairing-code')).toBe(code);
    expect(code.getAttribute('aria-busy')).toBe('false');
  });

  it('closes after the other computer approves', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<JoinComputer connections={[]} onClose={onClose} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await screen.findByText(/Your approval code will appear here/);
    rerender(<JoinComputer connections={[{ ...base, state: 'ready' } as never]} onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('shows the failure reason when no code', async () => {
    api.join.mockResolvedValue({ ...base, state: 'failed', reason: 'expired' });
    const onClose = vi.fn();
    render(<JoinComputer connections={[]} onClose={onClose} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('This invitation expired. Create a new invitation on the other computer.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('explains that an already-redeemed invitation did not complete the connection', async () => {
    api.join.mockResolvedValue({ ...base, state: 'failed', reason: 'already_redeemed' });
    render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('A previous attempt already used this invitation but did not connect. Create a new invitation on the other computer and try again.')).toBeTruthy();
  });

  it('names the computer this one is already connected to', async () => {
    api.join.mockResolvedValue({ ...base, state: 'failed', reason: 'already_connected', peer: { name: 'Studio Mac', fingerprint: 'f'.repeat(16) } });
    render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('This computer is already connected to Studio Mac. Remove it under Computers, then join again.')).toBeTruthy();
    cleanup();
    api.join.mockResolvedValue({ ...base, state: 'failed', reason: 'already_connected' });
    render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText('This computer is already connected to that computer. Remove it under Computers, then join again.')).toBeTruthy();
  });

  it('surfaces join errors', async () => {
    api.join.mockRejectedValueOnce(new Error('invalid invitation'));
    render(<JoinComputer connections={[]} />);
    fill('tok');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect((await screen.findByRole('alert')).textContent).toBe('invalid invitation');
    api.join.mockRejectedValueOnce('x');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Request failed'));
  });

  it('passes the typed approval code to join and surfaces a wrong-code rejection', async () => {
    api.join.mockRejectedValueOnce(new Error('identity_mismatch'));
    render(<JoinComputer connections={[]} />);
    fill('tok', 'WRNG-CODE');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(api.join).toHaveBeenCalledWith('tok', 'WRNG-CODE'));
    expect((await screen.findByRole('alert')).textContent).toBe('identity_mismatch');
  });
});

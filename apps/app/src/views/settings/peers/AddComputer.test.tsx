// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ checkRemoteLogin: vi.fn(), create: vi.fn(), approve: vi.fn(), deny: vi.fn(), copy: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ peerConnections: api, product: { clipboard: { writeText: api.copy } } }));
vi.mock('../../../lib/copy-text.js', () => ({ copyText: api.copy }));

import { AddComputer } from './AddComputer';

const ID = '11111111-1111-4111-8111-111111111111';
const created = { invitationId: ID, token: 'tok-123', expiresAt: 1_900_000_000_000, code: 'ABCD-EFGH' };
const reserved = { invitationId: ID, role: 'inviter', state: 'reserved', expiresAt: 1, awaitingApproval: true, peer: { name: 'Studio laptop', fingerprint: 'aa:bb' } } as never;

beforeEach(() => {
  api.checkRemoteLogin.mockReset().mockResolvedValue({ ok: true });
  api.create.mockReset().mockResolvedValue(created);
  api.approve.mockReset().mockResolvedValue({});
  api.deny.mockReset().mockResolvedValue({});
  api.copy.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { cc?: unknown }).cc;
});

describe('AddComputer', () => {
  it('shows directions and does not create when the connection service cannot start, then rechecks', async () => {
    api.checkRemoteLogin.mockResolvedValueOnce({ ok: false, reason: 'ssh_remote_login_off' });
    render(<AddComputer connections={[]} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not start its connection service/);
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByLabelText('Invitation')).toBeTruthy();
    expect(api.create).toHaveBeenCalledOnce();
  });

  it('never asks the owner to run a command or mention another computer', async () => {
    api.checkRemoteLogin.mockResolvedValueOnce({ ok: false, reason: 'ssh_stream_local_allowed' });
    render(<AddComputer connections={[]} />);
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toMatch(/not locked down/);
    expect(text).not.toMatch(/other computer|Terminal|sudo|Remote Login/);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('shows a generic title for an unknown reason', async () => {
    api.checkRemoteLogin.mockResolvedValueOnce({ ok: false, reason: 'mystery' });
    render(<AddComputer connections={[]} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot accept a connection yet/);
  });

  it('creates an invitation, shows the token, copies it and waits', async () => {
    const onChange = vi.fn();
    render(<AddComputer connections={[]} onChange={onChange} />);
     expect(((await screen.findByLabelText('Invitation')) as HTMLTextAreaElement).value).toBe('tok-123');
     // The approval code is shown for the owner to read aloud; it never travels inside the token.
     expect((await screen.findByTestId('approval-code')).textContent).toContain('ABCD-EFGH');
     expect(screen.getByLabelText('Approval code').textContent).toBe('ABCD-EFGH');
     expect(screen.getByText(/Waiting for the other computer/)).toBeTruthy();
    expect(screen.getByText(/Expires/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation' }));
    await waitFor(() => expect(api.copy).toHaveBeenCalledWith('tok-123'));
    expect((await screen.findByRole('button', { name: 'Copy invitation' })).textContent).toContain('Copied');
    expect(onChange).toHaveBeenCalled();
  });

  it('reports a copy failure', async () => {
    api.copy.mockRejectedValueOnce(new Error('denied'));
    render(<AddComputer connections={[]} />);
    await screen.findByLabelText('Invitation');
    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation' }));
    expect((await screen.findByRole('alert')).textContent).toBe('denied');
  });

  it('surfaces a create failure and can retry', async () => {
    api.create.mockRejectedValueOnce(new Error('too many'));
    const onClose = vi.fn();
    render(<AddComputer connections={[]} onClose={onClose} />);
    expect((await screen.findByRole('alert')).textContent).toBe('too many');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Invitation')).toBeTruthy();
  });

  it('renders Approve for a reserved inviter connection, then closes after approval', async () => {
    const onChange = vi.fn(), onClose = vi.fn();
    render(<AddComputer connections={[reserved]} onChange={onChange} onClose={onClose} />);
    expect(await screen.findByText('Studio laptop')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Code shown/), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(ID, 'ABCD-1234'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows deny failure', async () => {
    api.deny.mockRejectedValueOnce(new Error('nope'));
    render(<AddComputer connections={[reserved]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
  });

  it('shows connection state once past open', async () => {
    render(<AddComputer connections={[{ ...(reserved as object), state: 'connecting', awaitingApproval: false } as never]} />);
    expect(await screen.findByText('Status: connecting')).toBeTruthy();
  });
});

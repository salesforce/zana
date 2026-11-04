// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApproveConnection, normalizePairingCode } from './ApproveConnection';

afterEach(cleanup);
const input = () => screen.getByLabelText(/Code shown/) as HTMLInputElement;
const approve = () => screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;

describe('normalizePairingCode', () => {
  it('normalizes case, separators and look-alikes', () => {
    expect(normalizePairingCode('abcd-1234')).toBe('ABCD-1234');
    expect(normalizePairingCode(' ab cd 12 34 ')).toBe('ABCD-1234');
    expect(normalizePairingCode('IL0O-ILOO')).toBe('1100-1100');
  });
  it('rejects wrong length or characters', () => {
    expect(normalizePairingCode('ABC-123')).toBeNull();
    expect(normalizePairingCode('ABCD-12345')).toBeNull();
    expect(normalizePairingCode('ABCU-1234')).toBeNull();
    expect(normalizePairingCode('')).toBeNull();
  });
});

describe('ApproveConnection', () => {
  it('shows hostname, fingerprint, pairing-code guidance, and disables Approve until the code is well formed', () => {
    render(<ApproveConnection hostname="Studio laptop" fingerprint="aa:bb" onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText('Studio laptop')).toBeTruthy();
    expect(screen.getByText('aa:bb')).toBeTruthy();
    expect(input().placeholder).toBe('____-____');
    expect(screen.getByText('8 letters and digits, not case-sensitive')).toBeTruthy();
    expect(approve().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: 'abcd-12' } });
    expect(approve().disabled).toBe(true);
    fireEvent.change(input(), { target: { value: 'abcd-1234' } });
    expect(approve().disabled).toBe(false);
  });

  it('submits the normalized code', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ApproveConnection hostname="h" fingerprint="f" onApprove={onApprove} onDeny={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'il0o abcd' } });
    fireEvent.click(approve());
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('1100-ABCD'));
  });

  it('shows the server error and clears the input on failure', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('code mismatch'));
    render(<ApproveConnection hostname="h" fingerprint="f" onApprove={onApprove} onDeny={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'ABCD1234' } });
    fireEvent.click(approve());
    expect((await screen.findByRole('alert')).textContent).toBe('code mismatch');
    expect(input().value).toBe('');
    expect(approve().disabled).toBe(true);
  });

  it('falls back to a generic message for non-Error rejections', async () => {
    render(<ApproveConnection hostname="h" fingerprint="f" onApprove={() => Promise.reject('x')} onDeny={vi.fn()} />);
    fireEvent.change(input(), { target: { value: 'ABCD1234' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Request failed');
  });

  it('denies, and disables everything while busy', () => {
    const onDeny = vi.fn();
    const { rerender } = render(<ApproveConnection hostname="h" fingerprint="f" onApprove={vi.fn()} onDeny={onDeny} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalled();
    rerender(<ApproveConnection hostname="h" fingerprint="f" onApprove={vi.fn()} onDeny={onDeny} busy />);
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input().disabled).toBe(true);
  });
});

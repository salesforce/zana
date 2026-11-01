// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ComputerEnrollment } from './ComputerEnrollment';

afterEach(cleanup);
const target = { id: 'work', name: 'Work Mac', live: false, browserUrl: null as string | null };
function view(extra: Record<string, any> = {}) {
  const props = { enrollment: { name: 'Work Mac', approved: true, denied: false, serverId: 'work' }, computers: [target, { ...target, id: 'other', name: 'Other Mac' }], domain: 'zana-ide.com', api: vi.fn(async () => ({ available: true })), disabled: false, onApprove: vi.fn(), onChanged: vi.fn(async () => {}), onError: vi.fn(), ...extra };
  return { ...render(<ComputerEnrollment {...props} />), props };
}
it('continues approval into address selection for exactly the approved computer', async () => {
  const { props } = view();
  expect(screen.getByRole('heading', { name: 'Account connected' })).toBeTruthy();
  expect(screen.getByText(/Setup is not finished yet/)).toBeTruthy();
  expect(screen.queryByLabelText('Computer')).toBeNull();
  expect(screen.queryByText('Other Mac')).toBeNull();
  fireEvent.change(screen.getByLabelText('Your address'), { target: { value: 'work-mac' } });
  await screen.findByText('Available: https://work-mac.zana-ide.com');
  fireEvent.click(screen.getByRole('button', { name: 'Claim your address' }));
  await waitFor(() => expect(props.api).toHaveBeenCalledWith('/address', { serverId: 'work', label: 'work-mac' }));
  expect(props.onChanged).toHaveBeenCalledOnce();
});
it('requires explicit approval, supports decline, and honors disabled actions', () => {
  const { props, rerender } = view({ enrollment: { name: 'Work Mac', approved: false, denied: false } });
  expect(props.onApprove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Approve computer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
  expect(props.onApprove.mock.calls).toEqual([[true], [false]]);
  rerender(<ComputerEnrollment {...props} disabled />);
  expect((screen.getByRole('button', { name: 'Approve computer' }) as HTMLButtonElement).disabled).toBe(true);
});
it('distinguishes a saved address from a ready connection and provides a status retry', () => {
  const { props, rerender } = view({ computers: [{ ...target, browserUrl: 'https://work.zana-ide.com' }] });
  expect(screen.getByText(/Waiting for this computer/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Work Mac is ready' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  expect(props.onChanged).toHaveBeenCalledOnce();
  rerender(<ComputerEnrollment {...props} computers={[{ ...target, browserUrl: 'https://work.zana-ide.com', live: true }]} />);
  expect(screen.getByRole('heading', { name: 'Work Mac is ready' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check connection' })).toBeNull();
  expect(screen.getByRole('list').querySelector('[aria-current]')).toBeNull();
});
it('handles declined approvals without suggesting completion or an address', () => {
  view({ enrollment: { name: 'Work Mac', approved: true, denied: true } });
  expect(screen.getByRole('heading', { name: 'Computer declined' })).toBeTruthy();
  expect(screen.queryByLabelText('Your address')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
});
it.each([{ computers: [] }, { domain: undefined }])('provides a desktop continuation for older or missing setup metadata %j', extra => {
  view(extra);
  expect(screen.getByText(/Return to/)).toBeTruthy();
  expect(screen.queryByLabelText('Your address')).toBeNull();
});

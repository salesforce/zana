// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Connections } from './Connections';

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({ useRpc: () => rpc }));
afterEach(() => {
  cleanup();
  rpc.call.mockReset();
});
const click = async (name: string) => fireEvent.click(await screen.findByRole('button', { name, exact: true }));
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
it('connects a bot identity and disconnects, with a write-only consumer secret', async () => {
  let connected = false;
  rpc.call.mockImplementation(async (_method, { action }) => {
    if (action === 'status')
      return connected ? { origin: 'https://test.my.salesforce.com', mode: 'service' } : null;
    connected = action === 'connect';
    return { state: 'connected' };
  });
  render(<Connections bot="scout" token="owner" />);
  await click('Connect Salesforce');
  await click('Cancel');
  await click('Connect Salesforce');
  fill('My Domain URL', 'test.my.salesforce.com');
  fill('Consumer key', 'client');
  fill('Consumer secret', 'test-secret');
  expect((screen.getByLabelText('Consumer secret') as HTMLInputElement).type).toBe('password');
  await click('Connect');
  await screen.findByText('Salesforce · Bot service account');
  expect(rpc.call).toHaveBeenCalledWith('botConnection', {
    action: 'connect',
    mode: 'service',
    origin: 'test.my.salesforce.com',
    clientId: 'client',
    clientSecret: 'test-secret',
    bot: 'scout',
    token: 'owner'
  });
  await click('Disconnect');
  await screen.findByRole('button', { name: 'Connect Salesforce' });
});
it('handles a delegated consent, pending polling, and the saved account', async () => {
  let approved = false,
    polls = 0;
  rpc.call.mockImplementation(async (_method, { action }) => {
    if (action === 'status')
      return approved ? { origin: 'https://sample.my.salesforce.com', mode: 'delegated' } : null;
    if (action === 'finish') {
      if (++polls === 1) return { state: 'waiting', interval: 0.001 };
      approved = true;
      return { state: 'connected' };
    }
    return {
      state: 'waiting',
      ticket: 'ticket',
      code: 'TEST1234',
      url: 'https://sample.my.salesforce.com/setup/connect',
      interval: 0.05
    };
  });
  render(<Connections bot="scout" token="owner" />);
  await click('Connect Salesforce');
  fill('Salesforce identity', 'delegated');
  fill('My Domain URL', 'sample.my.salesforce.com');
  fill('Consumer key', 'fake-id');
  await click('Connect');
  expect((await screen.findByRole('link', { name: 'Verify with Salesforce' })).getAttribute('href')).toBe(
    'https://sample.my.salesforce.com/setup/connect'
  );
  await screen.findByText('Salesforce · My account');
  expect(polls).toBe(2);
});
it('recovers from status and authorization failures', async () => {
  rpc.call
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('Authorization declined'));
  render(<Connections bot="scout" token="owner" />);
  await click('Retry');
  await click('Connect Salesforce');
  fill('My Domain URL', 'sample.my.salesforce.com');
  fill('Consumer key', 'client');
  fill('Consumer secret', 'test');
  await click('Connect');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Authorization declined'));
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BotVault } from './storage.js';
import { VaultPanel } from './VaultPanel.js';
import { botScopeKey } from './items.js';

const mocks = vi.hoisted(() => ({ rpc: { call: vi.fn() } }));
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({ useRpc: () => mocks.rpc, useRealtime: vi.fn() }));
const bot = { id:'scout', name:'Scout', createdAt:4 };
afterEach(cleanup);
it('creates, filters, replaces and deletes shared items without prompting for a passphrase', async () => {
  const store = new Map<string,unknown>();
  const vault = new BotVault({get: async <T,>(k: string) => store.get(k) as T|undefined, set: async (k,v) => { store.set(k,v); }}, async () => Buffer.alloc(32, 9));
  mocks.rpc.call.mockImplementation(async (method, args) => {
    if (method === 'desktop.vaultStatus') return vault.status();
    if (method === 'desktop.vaultList') return vault.list();
    if (method === 'desktop.vaultSave') return vault.save(args.item,[bot]);
    if (method === 'desktop.vaultRemove') return vault.remove(args.id,args.revision);
    if (method === 'list') return [bot];
    throw new Error('Unexpected method');
  });
  render(<VaultPanel bot={bot}/>);
  const click = async (name: string|RegExp) => fireEvent.click(await screen.findByRole('button', {name,exact:true}));
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
  await screen.findByRole('button',{name:'New item'});
  expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
  expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
  await click('New item'); await click('Contact info');
  fill('Full name','Casey Chen'); fill('Email','casey@example.test');
  expect((screen.getByLabelText('Scout') as HTMLInputElement).checked).toBe(true);
  await click('Save item');
  await click('New item'); await click('Card');
  fill('Card number','4242424242424242'); fill('Expiry (MM/YY)','02/30');
  fill('Nickname','Travel'); fill('Security code (optional)','123');
  fireEvent.click(screen.getByLabelText('All current and future bots'));
  await click('Save item');
  const card = /Travel •••• 4242/;
  await screen.findByRole('button',{name:card});
  fill('Search Vault','unknown');
  expect(screen.getByText('No matching items.')).toBeTruthy();
  fill('Search Vault','');
  await click('Card · 1');
  expect(screen.queryByRole('button',{name:/Casey Chen/})).toBeNull();
  await click(card);
  await click('Replace Security code (optional)');
  await click('Save item');
  await click(card);
  expect(screen.queryByRole('button',{name:/Replace Security code/})).toBeNull();
  expect(screen.getByRole('button',{name:'Replace Card number'})).toBeTruthy();
  await click('Delete item'); await click('Confirm delete');
  await click('All · 1');
  expect(screen.queryByRole('button',{name:card})).toBeNull();
  await click(/Casey Chen/);
  await click('Cancel');
  expect(mocks.rpc.call.mock.calls.find(([method])=>method==='desktop.vaultSave')?.[1].item.scope).toEqual([botScopeKey(bot)]);
  vault.dispose();
});

it('requests the previous passphrase only for migration', async () => {
  let legacy = true;
  mocks.rpc.call.mockImplementation(async (method, args) => {
    if (method === 'desktop.vaultStatus') return {migrationRequired:legacy};
    if (method === 'desktop.vaultMigrate') {
      if (args.passphrase !== 'previous password') throw Error('Incorrect previous passphrase');
      legacy = false;
    }
    return [];
  });
  render(<VaultPanel />);
  const field = await screen.findByLabelText('Previous Vault passphrase') as HTMLInputElement;
  expect(field.type).toBe('password');
  fireEvent.change(field,{target:{value:'incorrect'}});
  fireEvent.click(screen.getByText('Migrate Vault'));
  await screen.findByText('Incorrect previous passphrase');
  expect(field.value).toBe('');
  fireEvent.change(field,{target:{value:'previous password'}});
  fireEvent.click(screen.getByText('Migrate Vault'));
  await screen.findByText('New item');
  expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
});

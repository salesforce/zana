import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { BotService } from '../service.js';
import { botScopeKey } from './items.js';
import { BotConnections } from '../connections/broker.js';
import { BotVault } from './storage.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Vault request.');
  return value as Record<string, unknown>;
}

export function registerVault(zcc: ZccPluginApi, bots: BotService) {
  const botExists = (key: string) => bots.store.snapshot().some(bot => botScopeKey(bot) === key);
  const connections = new BotConnections(zcc.storage.kv, undefined, Date.now, botExists);
  const vault = new BotVault(zcc.storage.kv, Date.now, () => zcc.realtime.publish('bots:vault-changed', {}), connections);
  zcc.background.service('vault-session', () => () => vault.dispose());
  zcc.rpc.method('vaultStatus', () => vault.status());
  zcc.rpc.method('vaultUnlock', input => {
    const args = record(input);
    return vault.unlock(args.passphrase, args.create === true);
  });
  zcc.rpc.method('vaultLock', input => vault.lock(record(input).token));
  zcc.rpc.method('vaultList', input => vault.list(record(input).token));
  zcc.rpc.method('vaultSave', async input => {
    const args = record(input);
    return vault.save(args.token, record(args.item), await bots.store.list());
  });
  zcc.rpc.method('vaultRemove', input => {
    const args = record(input);
    return vault.remove(args.token, args.id, args.revision);
  });
  zcc.rpc.method('botConnection', async input => {
    const args = record(input);
    vault.requireOwner(args.token);
    if (typeof args.bot !== 'string') throw new Error('Choose a bot.');
    const bot = await bots.requireBot(args.bot);
    const key = botScopeKey(bot);
    const owner = () => {
      vault.requireOwner(args.token);
      if (!botExists(key)) throw new Error('The bot was removed.');
    };
    switch (args.action) {
      case 'status': return connections.status(key, owner);
      case 'connect': return connections.connect(key, args, owner);
      case 'finish': return connections.finish(key, args.ticket, owner);
      case 'disconnect': return connections.disconnect(key, owner);
      default: throw new Error('Unknown connection action.');
    }
  });
  zcc.agents.registerTool({
    name: 'bot_assigned_cases',
    description: 'Read up to 20 open Salesforce cases assigned to this bot’s connected account. Works during scheduled routines.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (input, ctx) => {
      if (Object.keys(record(input)).length) throw new Error('This action takes no arguments.');
      const key = () => {
        const bot = bots.botForMainThread(ctx.threadId);
        if (!bot || bot.projectId !== ctx.projectId) throw new Error('Only the bot’s main thread can use this connection.');
        return botScopeKey(bot);
      };
      const identity = key();
      return connections.assignedCases(identity, () => key() === identity, ctx.signal);
    }
  });
  zcc.agents.registerTool({
    name: 'bot_vault_list',
    description: 'List Vault items the owner has shared with this bot. Shared contacts include their contact details. Logins and cards show only identifying details.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, ctx) => {
      const bot = bots.botForMainThread(ctx.threadId);
      if (!bot) throw new Error('Only a bot’s main thread can use its Vault.');
      return (await vault.shared(bot)).map(({ scope: _scope, revision: _revision, ...item }) => item);
    }
  });
  return vault;
}

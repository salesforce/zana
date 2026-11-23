import { toolInstructions } from '../instructions.js';
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
  const vault = new BotVault(zcc.storage.kv, () => zcc.storage.deviceKey(), () => zcc.realtime.publish('bots:vault-changed', {}), connections);
  zcc.background.service('vault-session', () => () => vault.dispose());
  zcc.rpc.method('desktop.vaultStatus', () => vault.status());
  zcc.rpc.method('desktop.vaultMigrate', input => vault.migrate(record(input).passphrase));
  zcc.rpc.method('desktop.vaultList', () => vault.list());
  zcc.rpc.method('desktop.vaultSave', async input => vault.save(record(record(input).item), await bots.store.list()));
  zcc.rpc.method('desktop.vaultRemove', input => {
    const args = record(input);
    return vault.remove(args.id, args.revision);
  });
  zcc.rpc.method('desktop.botConnection', async input => {
    const args = record(input);
    await vault.ensureReady();
    if (typeof args.bot !== 'string') throw new Error('Choose a bot.');
    const bot = await bots.requireBot(args.bot);
    const key = botScopeKey(bot);
    const owner = () => {
      if (!botExists(key)) throw new Error('The bot was removed.');
    };
    switch (args.action) {
      case 'status': return connections.status(key, owner);
      case 'connect': return connections.connect(key, args, owner);
      case 'replaceSecret': return connections.replaceSecret(key, args.clientSecret, owner);
      case 'finish': return connections.finish(key, args.ticket, owner);
      case 'disconnect': return connections.disconnect(key, owner);
      default: throw new Error('Unknown connection action.');
    }
  });
  zcc.agents.registerTool({
    name: 'bot_assigned_cases',
    description: toolInstructions.bot_assigned_cases,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (input, ctx) => {
      if (Object.keys(record(input)).length) throw new Error('This action takes no arguments.');
      const key = () => {
        const bot = bots.botForMainThread(ctx.threadId);
        if (!bot || bot.projectId !== ctx.projectId) throw new Error('Only the bot’s main thread can use this connection.');
        return botScopeKey(bot);
      };
      const identity = key();
      await vault.ensureReady();
      return connections.assignedCases(identity, () => key() === identity, ctx.signal);
    }
  });
  zcc.agents.registerTool({
    name: 'bot_vault_list',
    description: toolInstructions.bot_vault_list,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, ctx) => {
      const bot = bots.botForMainThread(ctx.threadId);
      if (!bot || bot.projectId !== ctx.projectId) throw new Error('Only a bot’s main thread can use its Vault.');
      return (await vault.shared(bot)).map(({ scope: _scope, revision: _revision, ...item }) => item);
    }
  });
  return vault;
}

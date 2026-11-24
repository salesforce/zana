import { toolInstructions } from '../instructions.js';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { BotService } from '../service.js';
import { BotVault } from './storage.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Vault request.');
  return value as Record<string, unknown>;
}

export function registerVault(zcc: ZccPluginApi, bots: BotService) {
  const vault = new BotVault(zcc.storage.kv, () => zcc.storage.deviceKey(), () => zcc.realtime.publish('bots:vault-changed', {}));
  zcc.background.service('vault-session', () => () => vault.dispose());
  zcc.rpc.method('desktop.vaultStatus', () => vault.status());
  zcc.rpc.method('desktop.vaultMigrate', input => vault.migrate(record(input).passphrase));
  zcc.rpc.method('desktop.vaultList', () => vault.list());
  zcc.rpc.method('desktop.vaultSave', async input => vault.save(record(record(input).item), await bots.store.list()));
  zcc.rpc.method('desktop.vaultRemove', input => {
    const args = record(input);
    return vault.remove(args.id, args.revision);
  });
  zcc.agents.registerTool({
    name: 'bot_vault_list',
    description: toolInstructions.bot_vault_list,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, ctx) => {
      const bot = bots.botActingAs(ctx.threadId);
      if (!bot || bot.projectId !== ctx.projectId) throw new Error('Only a bot’s main thread or its routines can use its Vault.');
      return (await vault.shared(bot)).map(({ scope: _scope, revision: _revision, ...item }) => item);
    }
  });
  return vault;
}

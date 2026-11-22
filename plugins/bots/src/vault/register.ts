import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { BotService } from '../service.js';
import { BotVault } from './storage.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Vault request.');
  return value as Record<string, unknown>;
}

export function registerVault(zcc: ZccPluginApi, bots: BotService) {
  const vault = new BotVault(zcc.storage.kv, Date.now, () => zcc.realtime.publish('bots:vault-changed', {}));
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

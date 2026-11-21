import { cronMatches, nextRoutineRun } from './src/cron.js';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { CLI_COMMANDS, runCli } from './src/cli.js';
import { BotValidationError } from './src/model.js';
import { BotService, errorMessage } from './src/service.js';
import { BotStore } from './src/store.js';
import { registerBotTools, toolsFor } from './src/tools.js';

export { BOTS_CHANGED_CHANNEL } from './src/service.js';

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function ref(args: Record<string, unknown>, field = 'bot'): string {
  const value = typeof args[field] === 'string' ? (args[field] as string).trim() : '';
  if (!value) throw new BotValidationError(`${field} is required`);
  return value;
}

export function registerRpc(zcc: Pick<ZccPluginApi, 'rpc' | 'sdk'>, service: BotService): void {
  zcc.rpc.method('list', () => service.listViews());
  zcc.rpc.method('get', async (raw) => {
    const bot = await service.requireBot(ref(record(raw)));
    return { bot: await service.view(bot), jobs: await service.jobs(bot.id) };
  });
  zcc.rpc.method('create', (raw) => service.create(record(raw)));
  zcc.rpc.method('update', (raw) => {
    const args = record(raw);
    return service.update(ref(args), record(args.patch));
  });
  zcc.rpc.method('remove', async (raw) => {
    const args = record(raw);
    const bot = await service.remove(ref(args), { archiveThreads: args.archiveThreads === true });
    return { id: bot.id };
  });
  zcc.rpc.method('send', async (raw) => {
    const args = record(raw);
    const result = await service.send(ref(args), String(args.message ?? ''), { kind: 'user', via: 'Bots panel' });
    return { threadId: result.threadId, created: result.created };
  });
  zcc.rpc.method('addRoutine', async (raw) => {
    const args = record(raw);
    return (await service.addRoutine(ref(args), record(args.routine))).bot;
  });
  zcc.rpc.method('updateRoutine', (raw) => {
    const args = record(raw);
    return service.updateRoutine(ref(args), ref(args, 'routineId'), record(args.patch));
  });
  zcc.rpc.method('removeRoutine', (raw) => {
    const args = record(raw);
    return service.removeRoutine(ref(args), ref(args, 'routineId'));
  });
  zcc.rpc.method('runRoutine', (raw) => {
    const args = record(raw);
    return service.runRoutine(ref(args), ref(args, 'routineId'));
  });
  zcc.rpc.method('catalog', async (raw) => {
    const providerId = typeof record(raw).providerId === 'string' ? (record(raw).providerId as string).trim() : '';
    const [projects, providers] = await Promise.all([
      zcc.sdk.projects.list().catch(() => []),
      zcc.sdk.providers.list().catch(() => [])
    ]);
    let models: string[] = [];
    let modelError: string | null = null;
    if (providerId) {
      try {
        const catalog = await zcc.sdk.providers.models({ providerId });
        models = catalog.models.map((row) => row.model || row.id);
        modelError = catalog.modelLoadError?.code ?? null;
      } catch (error) {
        modelError = errorMessage(error);
      }
    }
    return {
      projects: projects.map((row) => ({ id: row.id, name: row.name || row.id })),
      providers: providers.filter((row) => row.available).map((row) => ({ id: row.id, name: row.displayName ?? row.id })),
      models,
      modelError
    };
  });
  zcc.rpc.method('nextRuns', async (raw) => {
    const bot = await service.requireBot(ref(record(raw)));
    const now = Date.now();
    return Object.fromEntries(bot.routines.filter(r => r.enabled).map(r => [r.id, nextRoutineRun(r.cron, now)]));
  });
  zcc.rpc.method('jobs', async (raw) => service.jobs((await service.requireBot(ref(record(raw)))).id));
}

export default async function plugin(zcc: ZccPluginApi): Promise<void> {
  const store = new BotStore(zcc.storage.kv);
  const service = new BotService(zcc, store, cronMatches, () => Date.now(), zcc.storage.kv);
  await store.warm();

  // configure (not contributeInstructions) so the first turn of a freshly
  // spawned bot thread is recognised from its spawn metadata.
  zcc.agents.configure((ctx) => {
    const metadata = ctx.pluginMetadata ?? {};
    const instructions = service.instructionsFor(ctx.threadId, metadata);
    const role = metadata.botRole === 'main' || metadata.botRole === 'job'
      ? metadata.botRole
      : ctx.threadId ? service.roleOf(ctx.threadId).kind : 'thread';
    return { tools: toolsFor(role), ...(instructions ? { instructions } : {}) };
  });
  registerBotTools(zcc, service);
  registerRpc(zcc, service);

  zcc.cli.register({
    name: 'bots',
    summary: 'Persistent bots: one main thread, a personality, routines and background jobs',
    commands: CLI_COMMANDS,
    run: (argv, ctx) => runCli(service, argv, ctx)
  });

  zcc.background.schedule('routines', '* * * * *', async () => {
    try {
      await service.tick();
    } catch (error) {
      zcc.log.warn(`routine tick failed: ${errorMessage(error)}`);
    }
  });

  const isBotThread = (threadId: string) => service.instructionsFor(threadId) !== null;
  for (const name of ['thread.idle', 'thread.active', 'thread.failed'] as const) {
    zcc.events.on(name, (event) => {
      if (isBotThread(event.threadId)) service.changed();
    });
  }
  zcc.events.on('thread.deleted', async (event) => {
    if (!isBotThread(event.threadId)) return;
    service.changed();
    await service.forgetThread(event.threadId).catch((error: unknown) => {
      zcc.log.warn(`could not check deleted thread ${event.threadId}: ${errorMessage(error)}`);
    });
  });

  zcc.log.info('bots ready');
}

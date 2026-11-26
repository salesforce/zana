import { cronMatches, nextRoutineRun } from './src/cron.js';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { CLI_COMMANDS, runCli } from './src/cli.js';
import { BotValidationError } from './src/model.js';
import { BotService, errorMessage } from './src/service.js';
import { registerVault } from './src/vault/register.js';
import { HelperCatalog } from './src/helper/catalog-refresh.js';
import { browseGuides, guideMarkdown, HELPER_GUIDES_CHANGED } from './src/helper/catalog.js';
import { toolInstructions } from './src/instructions.js';
import { HELPER_NAME, HELPER_PERSONALITY, LEGACY_HELPER_KEY, type LegacyHelper } from './src/helper/shared.js';
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

export function registerRpc(zcc: Pick<ZccPluginApi, 'rpc' | 'sdk'>, service: BotService, provisionHelper: () => Promise<void>): void {
  zcc.rpc.method('list', async () => {
    await provisionHelper();
    return service.listViews();
  });
  zcc.rpc.method('threadBot', async raw => {
    const args = record(raw);
    const role = service.roleOf(ref(args, 'threadId'));
    if (role.kind === 'thread') return null;
    if (args.profile === true) return service.view(role.bot);
    const { id, name, color } = role.bot;
    return { id, name, color };
  });
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
  zcc.rpc.method('openThread', async raw => {
    const { threadId } = await service.openMainThread(ref(record(raw)));
    return { threadId };
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

  const catalog = new HelperCatalog(
    zcc.storage.kv,
    fetch,
    () => zcc.realtime.publish(HELPER_GUIDES_CHANGED, {}),
    message => zcc.log.debug(message)
  );
  const settings = zcc.settings.define({
    downloadGuideUpdates: {
      type: 'boolean',
      label: 'Download Zana guide updates',
      description: 'Check raw.githubusercontent.com for updates to the guides. Bundled and previously downloaded guides are available offline.',
      default: true
    }
  });
  let refreshSettingChanged = false;
  settings.onChange(values => {
    refreshSettingChanged = true;
    catalog.setRefreshEnabled(values.downloadGuideUpdates === true);
  });
  zcc.onDispose(() => catalog.setRefreshEnabled(false));
  const initialSettings = await settings.get().catch((error: unknown) => {
    zcc.log.warn(`could not load Bots settings: ${errorMessage(error)}`);
    return undefined;
  });
  if (!refreshSettingChanged) catalog.setRefreshEnabled(initialSettings?.downloadGuideUpdates === true);

  const legacyHelper = () => zcc.storage.kv.get<LegacyHelper>(LEGACY_HELPER_KEY);
  const provisionHelper = () => store.provisionHelper(async () => {
    const projects = await zcc.sdk.projects.list();
    const project = projects.find(row => row.quickAgent);
    if (!project) return null;
    const settings = (await legacyHelper())?.settings;
    const providerId = settings?.providerId;
    return {
      name: HELPER_NAME, personality: HELPER_PERSONALITY, projectId: project.id,
      providerId, model: providerId ? settings?.model : undefined
    };
  }).catch((error: unknown) => zcc.log.warn(`could not provision Zana Helper: ${errorMessage(error)}`));
  await provisionHelper();

  // configure (not contributeInstructions) so the first turn of a freshly
  // spawned bot thread is recognised from its spawn metadata.
  zcc.agents.configure((ctx) => {
    const role = service.roleFor(ctx.threadId, ctx.pluginMetadata ?? {});
    const instructions = service.instructionsFor(role);
    return { tools: toolsFor(role), ...(instructions ? { instructions } : {}) };
  });
  registerBotTools(zcc, service);
  registerVault(zcc, service);
  registerRpc(zcc, service, provisionHelper);
  zcc.rpc.method('helperGuides', () => catalog.entries());
  zcc.rpc.method('helperHistory', async () => (await legacyHelper())?.turns ?? []);
  zcc.agents.registerTool({
    name: 'bot_search_zana_guides',
    description: toolInstructions.bot_search_zana_guides,
    parameters: {
      type: 'object', properties: { query: { type: 'string', description: 'A Zana feature name or question.' } },
      required: ['query'], additionalProperties: false
    },
    presentation: { label: { pending: 'Searching Zana guides', completed: 'Searched Zana guides' }, icon: { glyph: 'Search' } },
    execute: async (raw, ctx) => {
      if (!service.botForMainThread(ctx.threadId)?.isHelper) {
        throw new BotValidationError('Open Zana Helper chat to search Zana guides.');
      }
      const query = ref(record(raw), 'query');
      if (query.length > 2_000) throw new BotValidationError('Use a search query of up to 2,000 characters.');
      return browseGuides(await catalog.entries(), query).slice(0, 4)
        .map(({ title, text, url }) => ({ title, text: guideMarkdown(text, url).slice(0, 6_000), url }));
    }
  });

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

  const isBotThread = (threadId: string) => service.roleOf(threadId).kind !== 'thread';
  for (const name of ['thread.idle', 'thread.active', 'thread.failed'] as const) {
    zcc.events.on(name, async (event) => {
      const role = service.roleOf(event.threadId);
      if (role.kind === 'thread') return;
      service.changed();
      // A quiet routine run finished: post its result (or nothing) to the main chat.
      if (role.kind === 'routine' && name !== 'thread.active') {
        await service.settleRoutineRun(event.threadId, name === 'thread.failed'
          ? { failed: event.error ?? null }
          : { text: event.lastAssistantText ?? null });
      }
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

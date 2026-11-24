import type { PluginCliCommandInfo, PluginCliContext, PluginCliResult } from '@zana-ai/zcc-plugin-sdk/server';
import { BotValidationError, type Bot } from './model.js';
import { errorMessage, type BotService, type Sender } from './service.js';
import { botSummary } from './tools.js';

export const CLI_COMMANDS: PluginCliCommandInfo[] = [
  { name: 'list', summary: 'List bots', usage: 'zcc bots list [--json]' },
  { name: 'show', summary: 'Show one bot with routines and jobs', usage: 'zcc bots show <bot> [--json]' },
  { name: 'create', summary: 'Create a bot', usage: 'zcc bots create <name> [--color #3b82f6] [--personality "..."] [--project <id>] [--provider <id>] [--model <id>]' },
  { name: 'update', summary: 'Update a bot', usage: 'zcc bots update <bot> [--name ..] [--color ..] [--personality ..] [--project ..] [--provider ..] [--model ..]' },
  { name: 'delete', summary: 'Delete a bot', usage: 'zcc bots delete <bot> [--archive-threads]' },
  { name: 'send', summary: 'Message or assign a task to a bot', usage: 'zcc bots send <bot> <message...>' },
  { name: 'routine', summary: 'Manage routines', usage: 'zcc bots routine add <bot> --name <n> --cron "<cron>" [--kind agent|reminder --prompt "<text>" | --kind price --asset BTC --currencies USD,CHF] | update <bot> <routine> [...] | remove <bot> <routine> | run <bot> <routine>' }
];

const FLAG_NAMES = new Set(['color', 'personality', 'project', 'provider', 'model', 'name', 'cron', 'prompt', 'enabled', 'kind', 'asset', 'currencies']);
const BOOLEAN_FLAGS = new Set(['json', 'archive-threads']);

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string>;
  switches: Set<string>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (BOOLEAN_FLAGS.has(rawName)) {
      switches.add(rawName);
      continue;
    }
    if (!FLAG_NAMES.has(rawName)) throw new BotValidationError(`unknown flag --${rawName}`);
    const value = inline ?? argv[index + 1];
    if (value === undefined) throw new BotValidationError(`--${rawName} needs a value`);
    if (inline === undefined) index += 1;
    flags.set(rawName, value);
  }
  return { positionals, flags, switches };
}

function help(): string {
  return ['Usage: zcc bots <command>', '', ...CLI_COMMANDS.map((row) => `  ${row.usage}\n      ${row.summary}`)].join('\n');
}

function botLine(bot: Bot): string {
  const routines = bot.routines.length ? ` · ${bot.routines.length} routine${bot.routines.length === 1 ? '' : 's'}` : '';
  return `${bot.name} (${bot.id})${bot.mainThreadId ? ` · thread ${bot.mainThreadId}` : ' · no thread yet'}${routines}`;
}

function botInput(flags: Map<string, string>) {
  return {
    ...(flags.has('name') ? { name: flags.get('name') } : {}),
    ...(flags.has('color') ? { color: flags.get('color') } : {}),
    ...(flags.has('personality') ? { personality: flags.get('personality') } : {}),
    ...(flags.has('project') ? { projectId: flags.get('project') } : {}),
    ...(flags.has('provider') ? { providerId: flags.get('provider') } : {}),
    ...(flags.has('model') ? { model: flags.get('model') } : {})
  };
}

function routineInput(flags: Map<string, string>) {
  const enabled = flags.get('enabled');
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') {
    throw new BotValidationError('--enabled must be true or false');
  }
  return {
    ...(flags.has('name') ? { name: flags.get('name') } : {}),
    ...(flags.has('kind') ? { kind: flags.get('kind') } : {}),
    ...(flags.has('asset') ? { asset: flags.get('asset') } : {}),
    ...(flags.has('currencies') ? { currencies: flags.get('currencies')!.split(',') } : {}),
    ...(flags.has('cron') ? { cron: flags.get('cron') } : {}),
    ...(flags.has('prompt') ? { prompt: flags.get('prompt') } : {}),
    ...(enabled !== undefined ? { enabled: enabled === 'true' } : {})
  };
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new BotValidationError(`${what} is required\n\n${help()}`);
  return value;
}

/**
 * A terminal call is the user. A call from a thread's shell is that thread: role
 * rules (jobs, self-messages, own routines only), rate limits and the honest
 * "[From thread …]" header apply. The shell has no approval sheet, so changing
 * another bot from there needs a grant the thread already holds (approved once
 * through the bot_routines tool); otherwise it fails with guidance, matching the tool path.
 */
function cliSender(ctx: PluginCliContext): Sender {
  return ctx.threadId ? { kind: 'agent', threadId: ctx.threadId } : { kind: 'user', via: 'zcc CLI' };
}

export async function runCli(service: BotService, argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
  try {
    const [command, ...rest] = argv;
    if (!command || command === 'help' || command === '--help' || command === '-h') return { exitCode: 0, stdout: help() };
    const { positionals, flags, switches } = parseArgs(rest);
    const json = switches.has('json');
    const out = (value: unknown, text: string): PluginCliResult => ({ exitCode: 0, stdout: json ? JSON.stringify(value, null, 2) : text });
    switch (command) {
      case 'list': {
        const bots = await service.store.list();
        return out(bots.map(botSummary), bots.length ? bots.map(botLine).join('\n') : 'No bots yet. Create one with: zcc bots create <name>');
      }
      case 'show': {
        const bot = await service.requireBot(need(positionals[0], 'bot'));
        const jobs = await service.jobs(bot.id);
        const lines = [
          botLine(bot),
          bot.personality ? `\n${bot.personality}` : '',
          bot.routines.length ? '\nRoutines:' : '',
          ...bot.routines.map((row) => `  ${row.enabled ? '●' : '○'} ${row.name} (${row.id}) · ${row.cron} · ${row.kind ?? 'agent'}`),
          jobs.length ? '\nJobs:' : '',
          ...jobs.slice(0, 10).map((job) => `  ${job.status} · ${job.title} (${job.threadId})`)
        ].filter(Boolean);
        return out({ ...bot, jobs }, lines.join('\n'));
      }
      case 'create': {
        const name = flags.get('name') ?? positionals.join(' ');
        const bot = await service.create({ ...botInput(flags), name, ...(flags.has('project') ? {} : ctx.projectId ? { projectId: ctx.projectId } : {}) });
        return out(bot, `Created ${botLine(bot)}`);
      }
      case 'update': {
        const target = await service.requireBot(need(positionals[0], 'bot'));
        await service.authorizeManage(cliSender(ctx), target);
        const bot = await service.update(target.id, botInput(flags));
        return out(bot, `Updated ${botLine(bot)}`);
      }
      case 'delete': {
        const target = await service.requireBot(need(positionals[0], 'bot'));
        await service.authorizeManage(cliSender(ctx), target);
        const bot = await service.remove(target.id, { archiveThreads: switches.has('archive-threads') });
        return out({ id: bot.id, deleted: true }, `Deleted ${bot.name}`);
      }
      case 'send': {
        const ref = need(positionals[0], 'bot');
        const message = need(positionals.slice(1).join(' ').trim(), 'message');
        const result = await service.send(ref, message, cliSender(ctx));
        return out({ bot: result.bot.id, threadId: result.threadId, created: result.created }, `Sent to ${result.bot.name} (thread ${result.threadId})`);
      }
      case 'routine': {
        const [action, ref, routineRef] = positionals;
        if (!['add', 'update', 'remove', 'run'].includes(action ?? '')) {
          throw new BotValidationError(`routine action must be add, update, remove or run\n\n${help()}`);
        }
        const bot = (await service.routineTarget(cliSender(ctx), need(ref, 'bot'), true)).id;
        switch (action) {
          case 'add': {
            const { routine } = await service.addRoutine(bot, routineInput(flags));
            return out(routine, `Added routine ${routine.name} (${routine.id}) · ${routine.cron}`);
          }
          case 'update': {
            const updated = await service.updateRoutine(bot, need(routineRef, 'routine'), routineInput(flags));
            return out(updated.routines, `Updated routine on ${updated.name}`);
          }
          case 'remove': {
            const updated = await service.removeRoutine(bot, need(routineRef, 'routine'));
            return out(updated.routines, `Removed routine from ${updated.name}`);
          }
          default: {
            const result = await service.runRoutine(bot, need(routineRef, 'routine'));
            return out(result, `Routine delivered to thread ${result.threadId}`);
          }
        }
      }
      default:
        return { exitCode: 1, stderr: `Unknown command "${command}"\n\n${help()}` };
    }
  } catch (error) {
    return { exitCode: 1, stderr: errorMessage(error) };
  }
}

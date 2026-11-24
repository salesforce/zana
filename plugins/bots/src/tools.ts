import { toolInstructions } from './instructions.js';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { BotValidationError, ROUTINE_KINDS, type Bot } from './model.js';
import type { Approver, BotService, ThreadRole } from './service.js';

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function str(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BotValidationError(`${field} is required`);
  return text;
}

export function botSummary(bot: Bot) {
  return {
    id: bot.id,
    name: bot.name,
    color: bot.color ?? null,
    personality: bot.personality.slice(0, 280),
    mainThreadId: bot.mainThreadId ?? null,
    routines: bot.routines.map(({ id, name, cron, enabled, kind = 'agent' }) => ({ id, name, cron, enabled, kind }))
  };
}

/** What an agent sees of a bot: no thread ids, so it cannot address bot threads directly. */
export function agentBotSummary(bot: Bot) {
  const { mainThreadId: _hidden, ...rest } = botSummary(bot);
  return { ...rest, hasMainThread: bot.mainThreadId !== undefined };
}

/** Every tool this plugin registers. */
export const BOT_TOOL_NAMES = ['bot_list', 'bot_send', 'bot_reply', 'bot_job_start', 'bot_routines', 'bot_create'] as const;

/**
 * Tools offered per thread role (the service enforces the same rules again).
 * Jobs only read; replies and jobs are for a bot's own main thread.
 */
export function toolsFor(role: ThreadRole['kind']): string[] {
  if (role === 'main') return [...BOT_TOOL_NAMES, 'bot_vault_list', 'bot_assigned_cases'];
  if (role === 'job') return ['bot_list'];
  return ['bot_list', 'bot_send', 'bot_routines', 'bot_create'];
}

/** Human approval through the host's sheet, consumed in the same invocation. */
export function hostApprover(zcc: Pick<ZccPluginApi, 'ui'>): Approver {
  return async ({ bot, summary }) => {
    const binding = {
      action: 'bots.manage',
      target: bot.id,
      targetLabel: bot.name.slice(0, 200),
      subject: 'Change a full-permission bot'
    };
    const result = await zcc.ui.requestToolApproval({
      binding,
      title: `Allow this thread to change ${bot.name}?`,
      summary: `${summary} Approval lasts 8 hours for this thread.`.slice(0, 600),
      confirmLabel: 'Allow',
      tone: 'danger'
    });
    if (!result.approved) return false;
    return zcc.ui.consumeApproval({ token: result.token, binding });
  };
}

export function registerBotTools(zcc: Pick<ZccPluginApi, 'agents' | 'ui'>, service: BotService): void {
  const approve = hostApprover(zcc);

  zcc.agents.registerTool({
    name: 'bot_list',
    description: toolInstructions.bot_list,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    presentation: { label: { pending: 'Listing bots', completed: 'Listed bots' }, icon: { glyph: 'Bot' } },
    execute: async () => (await service.store.list()).map(agentBotSummary)
  });

  zcc.agents.registerTool({
    name: 'bot_send',
    description: toolInstructions.bot_send,
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot id or name.' },
        message: { type: 'string', description: 'The message or task for the bot.' }
      },
      required: ['bot', 'message'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Messaging bot', completed: 'Messaged bot' }, icon: { glyph: 'Send' } },
    execute: async (input, ctx) => {
      const args = record(input);
      const result = await service.send(str(args.bot, 'bot'), str(args.message, 'message'), { kind: 'agent', threadId: ctx.threadId });
      return { bot: result.bot.name, threadId: result.threadId, createdMainThread: result.created };
    }
  });

  zcc.agents.registerTool({
    name: 'bot_reply',
    description: toolInstructions.bot_reply,
    parameters: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The thread to answer.' },
        message: { type: 'string', description: 'Your answer.' }
      },
      required: ['threadId', 'message'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Replying', completed: 'Replied' }, icon: { glyph: 'Reply' } },
    execute: async (input, ctx) => {
      const args = record(input);
      return service.reply(ctx.threadId, str(args.threadId, 'threadId'), str(args.message, 'message'));
    }
  });

  zcc.agents.registerTool({
    name: 'bot_job_start',
    description: toolInstructions.bot_job_start,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Complete, self-contained instructions for the job.' },
        title: { type: 'string', description: 'Short label for the job.' }
      },
      required: ['prompt'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Starting background job', completed: 'Started background job' }, icon: { glyph: 'Layers' } },
    execute: async (input, ctx) => service.startJob(ctx.threadId, record(input))
  });

  zcc.agents.registerTool({
    name: 'bot_routines',
    description: toolInstructions.bot_routines,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'run'] },
        bot: { type: 'string', description: 'Bot id or name; optional from a bot main thread.' },
        routine: { type: 'string', description: 'Routine id or name (update/remove/run).' },
        name: { type: 'string' },
        cron: { type: 'string' },
        kind: { type: 'string', enum: Object.keys(ROUTINE_KINDS) },
        asset: { type: 'string', description: 'Base symbol for price checks, e.g. BTC.' },
        currencies: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'Quote currencies, e.g. ["USD", "CHF"].' },
        prompt: { type: 'string' },
        enabled: { type: 'boolean' }
      },
      required: ['action'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Updating routines', completed: 'Updated routines' }, icon: { glyph: 'CalendarClock' } },
    execute: async (input, ctx) => {
      const args = record(input);
      const ref = typeof args.bot === 'string' && args.bot.trim() ? args.bot.trim() : undefined;
      if (!['list', 'add', 'update', 'remove', 'run'].includes(String(args.action))) {
        throw new BotValidationError('action must be list, add, update, remove or run');
      }
      const bot = await service.routineTarget({ kind: 'agent', threadId: ctx.threadId, approve }, ref, args.action !== 'list');
      const fields = { name: args.name, cron: args.cron, prompt: args.prompt, enabled: args.enabled, kind: args.kind, asset: args.asset, currencies: args.currencies };
      switch (args.action) {
        case 'list':
          return bot.routines;
        case 'add':
          return (await service.addRoutine(bot.id, fields)).routine;
        case 'update':
          return (await service.updateRoutine(bot.id, str(args.routine, 'routine'), fields)).routines;
        case 'remove':
          return (await service.removeRoutine(bot.id, str(args.routine, 'routine'))).routines;
        default:
          return service.runRoutine(bot.id, str(args.routine, 'routine'));
      }
    }
  });

  zcc.agents.registerTool({
    name: 'bot_create',
    description: toolInstructions.bot_create,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        personality: { type: 'string', description: 'Role, tone, responsibilities and boundaries.' }
      },
      required: ['name'],
      additionalProperties: false
    },
    presentation: { label: { pending: 'Creating bot', completed: 'Created bot' }, icon: { glyph: 'Bot' } },
    execute: async (input, ctx) => {
      const args = record(input);
      if (service.roleOf(ctx.threadId).kind === 'job') throw new BotValidationError('background jobs cannot create bots');
      return agentBotSummary(await service.create({ name: args.name, personality: args.personality, projectId: ctx.projectId }));
    }
  });
}

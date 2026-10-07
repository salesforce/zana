/**
 * `zcc design-docs …` — the shell twin of the design_doc_* agent tools, for
 * harnesses that only have a terminal and for scripting. Verbs delegate to the
 * same operations as the tools so both surfaces stay in lockstep.
 */
import { isAbsolute, join } from 'node:path';
import type { PluginCliContext, PluginCliResult, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { DocActor } from '../shared/contract.js';
import { formatBundle } from './format.js';
import {
  commentDoc,
  createDoc,
  docHistory,
  listDocs,
  readDoc,
  updateDoc,
  writeDoc,
  type OperationContext
} from './operations.js';
import { DesignDocError, type DesignDocStore } from './store.js';

export const CLI_NAME = 'design-docs';

export const CLI_COMMANDS = [
  { name: 'list', summary: 'List design docs', usage: 'list [--query <text>] [--status active|all|<status>] [--all-projects] [--json]' },
  { name: 'show', summary: 'Show a doc manifest and its entry file', usage: 'show <doc> [--all] [--json]' },
  { name: 'read', summary: 'Print one file raw', usage: 'read <doc> <path>' },
  {
    name: 'create',
    summary: 'Create a design doc',
    usage: 'create --title <title> [--summary <text>] [--template technical|product|adr|api|blank] [--tags a,b] [--global]'
  },
  {
    name: 'write',
    summary: 'Write a whole file (creates it if missing)',
    usage: 'write <doc> <path> (--file <local-path> | --content <text>) [--base-revision <n>] [--note <text>]'
  },
  {
    name: 'edit',
    summary: 'Exact-match replace inside a file',
    usage: 'edit <doc> <path> --old <text> --new <text> [--replace-all] [--base-revision <n>] [--note <text>]'
  },
  { name: 'rm', summary: 'Delete a file (kept in history)', usage: 'rm <doc> <path> [--base-revision <n>]' },
  { name: 'mv', summary: 'Rename a file', usage: 'mv <doc> <from> <to> [--base-revision <n>]' },
  {
    name: 'update',
    summary: 'Change title, summary, status, tags or entry file',
    usage: 'update <doc> [--title <t>] [--summary <s>] [--status <status>] [--tags a,b] [--entry <path>]'
  },
  { name: 'comment', summary: 'Add a review comment', usage: 'comment <doc> <body> [--path <file>] [--quote <text>]' },
  { name: 'resolve', summary: 'Resolve a comment', usage: 'resolve <doc> <comment-id> [--note <reply>]' },
  { name: 'history', summary: 'Show revision history', usage: 'history <doc> [--path <file>] [--limit <n>]' },
  { name: 'export', summary: 'Print every file as one bundle', usage: 'export <doc> [--json]' }
] as const;

const BOOLEAN_FLAGS = new Set(['json', 'all', 'all-projects', 'global', 'replace-all', 'help']);

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--') {
      positional.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(body)) {
        flags[body] = true;
      } else {
        const value = argv[index + 1];
        if (value === undefined) throw new DesignDocError('invalid', `--${body} needs a value`);
        flags[body] = value;
        index += 1;
      }
    } else if (arg === '-h') {
      flags.help = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export function helpText(): string {
  const width = Math.max(...CLI_COMMANDS.map((command) => command.name.length));
  return [
    'zcc design-docs — design documents your agents can read and edit',
    '',
    'Commands:',
    ...CLI_COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Usage:',
    ...CLI_COMMANDS.map((command) => `  zcc design-docs ${command.usage}`),
    '',
    '<doc> is a design doc id (dd_…) or slug.'
  ].join('\n');
}

export interface CliDeps {
  store: DesignDocStore;
  changed(docId: string): void;
  actorFor(threadId: string): Promise<DocActor>;
  readLocalFile(args: { threadId: string; path: string; cwd?: string }): Promise<string>;
}

const CLI_USER: DocActor = { kind: 'user', label: 'CLI', threadId: null };

function stringFlag(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function need(positional: string[], index: number, name: string): string {
  const value = positional[index];
  if (!value) throw new DesignDocError('invalid', `missing <${name}>; see zcc design-docs help`);
  return value;
}

export async function runCli(deps: CliDeps, argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
  try {
    const stdout = await dispatch(deps, argv, ctx);
    return { exitCode: 0, stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: error instanceof DesignDocError && error.code === 'invalid' ? 2 : 1, stderr: `${message}\n` };
  }
}

async function dispatch(deps: CliDeps, argv: string[], ctx: PluginCliContext): Promise<string> {
  const [verb, ...rest] = argv;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') return helpText();
  const { positional, flags } = parseArgs(rest);
  if (flags.help) return helpText();
  const operation: OperationContext = { store: deps.store, changed: deps.changed, projectId: ctx.projectId ?? null };
  const actor = async () => (ctx.threadId ? deps.actorFor(ctx.threadId) : CLI_USER);
  const baseRevision = stringFlag(flags, 'base-revision');
  const note = stringFlag(flags, 'note');
  const json = flags.json === true;

  switch (verb) {
    case 'list': {
      const scope = flags['all-projects'] === true ? 'all' : 'project';
      if (json) {
        const docs = deps.store.list({
          projectId: scope === 'project' && ctx.projectId ? ctx.projectId : undefined,
          query: stringFlag(flags, 'query'),
          status: (stringFlag(flags, 'status') ?? 'active') as 'active'
        });
        return JSON.stringify(docs, null, 2);
      }
      return listDocs(operation, { query: stringFlag(flags, 'query'), status: stringFlag(flags, 'status'), scope });
    }
    case 'show': {
      const ref = need(positional, 0, 'doc');
      if (json) return JSON.stringify(deps.store.get(ref), null, 2);
      const result = readDoc(operation, { doc: ref, includeAll: flags.all === true });
      return typeof result === 'string' ? result : result.content.map((part) => ('text' in part ? part.text : '')).join('\n');
    }
    case 'read': {
      const file = deps.store.readFile(need(positional, 0, 'doc'), need(positional, 1, 'path'));
      return file.content;
    }
    case 'create':
      return createDoc(
        operation,
        {
          title: stringFlag(flags, 'title') ?? positional.join(' '),
          summary: stringFlag(flags, 'summary'),
          template: stringFlag(flags, 'template'),
          tags: stringFlag(flags, 'tags'),
          status: stringFlag(flags, 'status'),
          global: flags.global === true
        },
        await actor()
      );
    case 'write': {
      const ref = need(positional, 0, 'doc');
      const path = need(positional, 1, 'path');
      const filePath = stringFlag(flags, 'file');
      let content = stringFlag(flags, 'content');
      if (filePath !== undefined && content !== undefined) {
        throw new DesignDocError('invalid', 'pass either --file or --content, not both');
      }
      if (filePath !== undefined) {
        if (!ctx.threadId) throw new DesignDocError('invalid', '--file needs an agent thread; use --content instead');
        content = await deps.readLocalFile({ threadId: ctx.threadId, path: filePath, cwd: ctx.cwd });
      }
      if (content === undefined) throw new DesignDocError('invalid', 'write needs --file <path> or --content <text>');
      return writeDoc(operation, { doc: ref, path, content, baseRevision, note }, await actor());
    }
    case 'edit': {
      const oldText = stringFlag(flags, 'old');
      const newText = stringFlag(flags, 'new');
      if (oldText === undefined || newText === undefined) {
        throw new DesignDocError('invalid', 'edit needs --old <text> and --new <text>');
      }
      return writeDoc(
        operation,
        {
          doc: need(positional, 0, 'doc'),
          path: need(positional, 1, 'path'),
          edits: [{ oldText, newText, replaceAll: flags['replace-all'] === true }],
          baseRevision,
          note
        },
        await actor()
      );
    }
    case 'rm':
      return writeDoc(
        operation,
        { doc: need(positional, 0, 'doc'), path: need(positional, 1, 'path'), delete: true, baseRevision, note },
        await actor()
      );
    case 'mv':
      return writeDoc(
        operation,
        {
          doc: need(positional, 0, 'doc'),
          path: need(positional, 1, 'from'),
          renameTo: need(positional, 2, 'to'),
          baseRevision,
          note
        },
        await actor()
      );
    case 'update':
      return updateDoc(
        operation,
        {
          doc: need(positional, 0, 'doc'),
          title: stringFlag(flags, 'title'),
          summary: stringFlag(flags, 'summary'),
          status: stringFlag(flags, 'status'),
          tags: stringFlag(flags, 'tags'),
          entryPath: stringFlag(flags, 'entry')
        },
        await actor()
      );
    case 'comment':
      return commentDoc(
        operation,
        {
          doc: need(positional, 0, 'doc'),
          body: positional.slice(1).join(' ') || stringFlag(flags, 'body'),
          path: stringFlag(flags, 'path'),
          quote: stringFlag(flags, 'quote')
        },
        await actor()
      );
    case 'resolve':
      return commentDoc(
        operation,
        { doc: need(positional, 0, 'doc'), resolve: need(positional, 1, 'comment-id'), body: note },
        await actor()
      );
    case 'history':
      return docHistory(operation, {
        doc: need(positional, 0, 'doc'),
        path: stringFlag(flags, 'path'),
        limit: stringFlag(flags, 'limit')
      });
    case 'export': {
      const ref = need(positional, 0, 'doc');
      const detail = deps.store.get(ref);
      const files = deps.store.readAllFiles(detail.id);
      if (json) return JSON.stringify({ ...detail, files }, null, 2);
      return formatBundle(detail, files, { maxChars: Number.MAX_SAFE_INTEGER });
    }
    default:
      throw new DesignDocError('invalid', `unknown command "${verb}"\n\n${helpText()}`);
  }
}

export function registerDesignDocCli(zcc: Pick<ZccPluginApi, 'cli'>, deps: CliDeps): void {
  zcc.cli.register({
    name: CLI_NAME,
    summary: 'Read and edit design docs (specs, RFCs, ADRs) shared with your agents',
    commands: CLI_COMMANDS.map((command) => ({ ...command })),
    run: (argv, ctx) => runCli(deps, argv, ctx)
  });
}

/** Resolve a CLI `--file` against the calling thread's cwd on its own host. */
export function createLocalFileReader(
  sdk: Pick<ZccPluginApi['sdk'], 'threads' | 'files'>
): CliDeps['readLocalFile'] {
  return async ({ threadId, path, cwd }) => {
    const thread = await sdk.threads.get({ threadId });
    if (!thread) throw new DesignDocError('not_found', `thread ${threadId} not found`);
    const absolute = isAbsolute(path) ? path : cwd ? join(cwd, path) : path;
    const result = await sdk.files.read({
      hostId: thread.hostId,
      path: absolute,
      ...(cwd ? { rootPath: cwd } : {})
    });
    if (result.contentEncoding !== 'utf8') {
      throw new DesignDocError('invalid', `${path} is not a text file`);
    }
    return result.content;
  };
}

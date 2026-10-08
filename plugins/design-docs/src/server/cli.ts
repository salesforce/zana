/**
 * `zcc design-docs …` — the shell twin of the design_doc_* agent tools, for
 * harnesses that only have a terminal and for scripting. Verbs delegate to the
 * same operations as the tools so both surfaces stay in lockstep.
 */
import { join, relative, resolve, sep } from 'node:path';
import type { PluginCliContext, PluginCliResult, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { DocActor } from '../shared/contract.js';
import { formatBytes } from '../shared/display.js';
import { MAX_DOC_BYTES, MAX_FILES_PER_DOC } from '../shared/limits.js';
import { DESIGN_DOC_TEMPLATES } from '../shared/templates.js';
import { formatBundle } from './format.js';
import {
  commentDoc,
  createDoc,
  docHistory,
  docRef,
  listDocs,
  readDoc,
  updateDoc,
  writeDoc,
  type OperationContext
} from './operations.js';
import { NO_KIT, type KitReader } from './pages.js';
import type { ProjectNames } from './project-names.js';
import type { RenderReports } from './render-reports.js';
import { importSkipReason, mapBounded, siteFiles } from './site-files.js';
import { CLI_AGENT_LABEL, DesignDocError, type DesignDocStore } from './store.js';

export const CLI_NAME = 'design-docs';

export const CLI_COMMANDS = [
  { name: 'list', summary: 'List design docs', usage: 'list [--query <text>] [--status active|all|<status>] [--all-projects] [--json]' },
  { name: 'show', summary: 'Show a doc manifest and its entry file', usage: 'show <doc> [--all] [--json]' },
  { name: 'read', summary: 'Print one text file raw', usage: 'read <doc> <path>' },
  {
    name: 'create',
    summary: 'Create a design doc',
    usage: `create --title <title> [--summary <text>] [--template ${DESIGN_DOC_TEMPLATES.map((template) => template.id).join('|')}] [--status <status>] [--tags a,b] [--global]`
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
  { name: 'rm', summary: 'Delete a file (kept in history)', usage: 'rm <doc> <path> [--base-revision <n>] [--note <text>]' },
  { name: 'mv', summary: 'Rename a file', usage: 'mv <doc> <from> <to> [--base-revision <n>] [--note <text>]' },
  {
    name: 'update',
    summary: 'Change title, summary, status, tags or entry file',
    usage: 'update <doc> [--title <t>] [--summary <s>] [--status <status>] [--tags a,b] [--entry <path>]'
  },
  { name: 'comment', summary: 'Add a review comment', usage: 'comment <doc> <body> [--path <file>] [--quote <text>]' },
  { name: 'reply', summary: 'Reply to a comment', usage: 'reply <doc> <comment-id> <body>' },
  { name: 'resolve', summary: 'Resolve a comment', usage: 'resolve <doc> <comment-id> [--note <reply>]' },
  { name: 'reopen', summary: 'Reopen a resolved comment', usage: 'reopen <doc> <comment-id> [--note <reply>]' },
  { name: 'history', summary: 'Show revision history', usage: 'history <doc> [--path <file>] [--limit <n>]' },
  {
    name: 'import',
    summary: 'Bring local files (a site folder) into a doc, or into a new one with --title',
    usage: 'import (<doc> | --title <title>) <file>... [--base <folder>] [--entry <path>] [--note <text>] [--global]'
  },
  {
    name: 'export',
    summary: 'Write the doc as a static site (--out), or print it as one bundle',
    usage: 'export <doc> (--out <folder> | [--json])'
  },
  { name: 'preview', summary: 'Print the URL of an HTML page rendered like the published site', usage: 'preview <doc> [<page.html>]' }
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
    '<doc> is a design doc id (dd_…) or slug.',
    'Publish a site: zcc design-docs export <doc> --out docs, commit it, then serve that folder with GitHub Pages.'
  ].join('\n');
}

/** Where `--file` may read: a registered project (or its environment) on its host. */
export interface FileRoot {
  hostId?: string;
  root: string;
}

/** Who runs a verb, worked out from the host's records rather than the caller's env. */
export interface CliCaller {
  actor: DocActor;
  projectId: string | null;
  files: FileRoot | null;
}

/** A file on the caller's host. */
export interface LocalFile {
  content: string;
  encoding: 'utf8' | 'base64';
  sizeBytes: number;
}

export interface CliDeps {
  store: DesignDocStore;
  changed(docId: string): void;
  caller(ctx: PluginCliContext): Promise<CliCaller>;
  readLocalFile(args: { files: FileRoot; path: string; cwd?: string }): Promise<LocalFile>;
  /** Write (creating folders) on the caller's host, confined to its project root. */
  writeLocalFile?(args: { files: FileRoot; path: string; content: string; encoding: 'utf8' | 'base64' }): Promise<void>;
  projects?: ProjectNames;
  /** Absolute URL of a doc page on the product server. */
  pageUrl?(docId: string, path: string): string;
  kit?: KitReader;
  reports?: RenderReports;
}

const CLI_USER: DocActor = { kind: 'user', label: 'CLI', threadId: null };

/** Bound on the bundle `export` prints; the host refuses CLI output over 1 MiB. */
export const EXPORT_MAX_CHARS = 900_000;

/** Files `import` reads, or `export --out` writes, at once. */
export const FILE_CONCURRENCY = 8;

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
  const [caller] = await Promise.all([deps.caller(ctx), deps.projects?.refresh()]);
  const projectName = (projectId: string | null) => deps.projects?.name(projectId) ?? null;
  const operation: OperationContext = {
    store: deps.store,
    changed: deps.changed,
    projectId: caller.projectId,
    projectName,
    kit: deps.kit,
    reports: deps.reports
  };
  const ref = (index: number) => docRef(operation, need(positional, index, 'doc'));
  const baseRevision = stringFlag(flags, 'base-revision');
  const note = stringFlag(flags, 'note');
  const json = flags.json === true;

  switch (verb) {
    case 'list': {
      const scope = flags['all-projects'] === true ? 'all' : 'project';
      if (json) {
        const docs = deps.store.list({
          projectId: scope === 'project' && caller.projectId ? caller.projectId : undefined,
          query: stringFlag(flags, 'query'),
          status: (stringFlag(flags, 'status') ?? 'active') as 'active'
        });
        return JSON.stringify(docs, null, 2);
      }
      return listDocs(operation, { query: stringFlag(flags, 'query'), status: stringFlag(flags, 'status'), scope });
    }
    case 'show': {
      if (json) return JSON.stringify(deps.store.get(ref(0)), null, 2);
      const result = readDoc(operation, { doc: need(positional, 0, 'doc'), includeAll: flags.all === true });
      return typeof result === 'string' ? result : result.content.map((part) => ('text' in part ? part.text : '')).join('\n');
    }
    case 'read': {
      const file = deps.store.readFile(ref(0), need(positional, 1, 'path'));
      if (file.encoding !== 'utf8') {
        throw new DesignDocError('invalid', `${file.path} is a binary file; open it in the Design Docs panel or read it with the design_doc_read tool`);
      }
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
        caller.actor
      );
    case 'write': {
      const path = need(positional, 1, 'path');
      const filePath = stringFlag(flags, 'file');
      let content = stringFlag(flags, 'content');
      if (filePath !== undefined && content !== undefined) {
        throw new DesignDocError('invalid', 'pass either --file or --content, not both');
      }
      if (filePath !== undefined) {
        if (!caller.files) {
          throw new DesignDocError('invalid', '--file reads only inside a registered project; run it from the project folder or pass --content');
        }
        const file = await deps.readLocalFile({ files: caller.files, path: filePath, cwd: ctx.cwd });
        if (file.encoding !== 'utf8') {
          throw new DesignDocError('invalid', `${filePath} is not a text file; bring images and fonts in with zcc design-docs import`);
        }
        content = file.content;
      }
      if (content === undefined) throw new DesignDocError('invalid', 'write needs --file <path> or --content <text>');
      return writeDoc(operation, { doc: need(positional, 0, 'doc'), path, content, baseRevision, note }, caller.actor);
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
        caller.actor
      );
    }
    case 'rm':
      return writeDoc(
        operation,
        { doc: need(positional, 0, 'doc'), path: need(positional, 1, 'path'), delete: true, baseRevision, note },
        caller.actor
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
        caller.actor
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
        caller.actor
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
        caller.actor
      );
    case 'reply':
      return commentDoc(
        operation,
        {
          doc: need(positional, 0, 'doc'),
          replyTo: need(positional, 1, 'comment-id'),
          body: positional.slice(2).join(' ') || stringFlag(flags, 'body')
        },
        caller.actor
      );
    case 'resolve':
    case 'reopen':
      return commentDoc(
        operation,
        { doc: need(positional, 0, 'doc'), [verb]: need(positional, 1, 'comment-id'), body: note },
        caller.actor
      );
    case 'history':
      return docHistory(operation, {
        doc: need(positional, 0, 'doc'),
        path: stringFlag(flags, 'path'),
        limit: stringFlag(flags, 'limit')
      });
    case 'import':
      return importFiles(deps, operation, caller, positional, flags, ctx);
    case 'export': {
      if (flags.out !== undefined) return exportSite(deps, caller, ref(0), flags, ctx);
      const detail = deps.store.get(ref(0));
      const files = deps.store.readAllFiles(detail.id);
      if (json) {
        const text = JSON.stringify({ ...detail, files }, null, 2);
        if (text.length > EXPORT_MAX_CHARS) {
          throw new DesignDocError('limit', `${detail.id} is too large for --json here; export it without --json for a bounded bundle`);
        }
        return text;
      }
      return formatBundle(detail, files, { maxChars: EXPORT_MAX_CHARS, projectName: projectName(detail.projectId) });
    }
    case 'preview': {
      if (!deps.pageUrl) throw new DesignDocError('invalid', 'previews are not available here');
      const doc = deps.store.summary(ref(0));
      const file = deps.store.readFile(doc.id, positional[1] ?? doc.entryPath);
      if (file.kind !== 'html') {
        throw new DesignDocError('invalid', `${file.path} is not an HTML page; pass one, e.g. zcc design-docs preview ${doc.slug} index.html`);
      }
      const url = deps.pageUrl(doc.id, file.path);
      return [
        url,
        '',
        'Open it in any browser on this machine; reload to see later edits. Pages run sandboxed, as on a static host.',
        `From a thread, show it in the app's browser panel: zcc browser create --url '${url}' --reveal (plus --host/--instance/--generation/--thread from zcc browser instances).`
      ].join('\n');
    }
    default:
      throw new DesignDocError('invalid', `unknown command "${verb}"\n\n${helpText()}`);
  }
}

function projectFiles(caller: CliCaller, verb: string): FileRoot {
  if (!caller.files) {
    throw new DesignDocError('invalid', `${verb} works only inside a registered project; run it from the project folder`);
  }
  return caller.files;
}

/** A caller's path made absolute: from its cwd when that is inside the project, else from the project root. */
function localPath(files: FileRoot, path: string, cwd: string | undefined): string {
  return resolve(cwd && isInside(cwd, files.root) ? cwd : files.root, path);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Local files into a doc as one change. The caller's shell lists them
 * (`$(git ls-files site)`), so this works the same on a remote host; doc paths
 * are relative to --base. Hidden files, dependencies and the site kit stay out.
 */
async function importFiles(
  deps: CliDeps,
  operation: OperationContext,
  caller: CliCaller,
  positional: string[],
  flags: ParsedArgs['flags'],
  ctx: PluginCliContext
): Promise<string> {
  const title = stringFlag(flags, 'title');
  const target = title === undefined ? deps.store.summary(docRef(operation, need(positional, 0, 'doc'))) : null;
  const requested = target ? positional.slice(1) : positional;
  if (requested.length === 0) {
    throw new DesignDocError('invalid', 'import needs the files to bring in, e.g. zcc design-docs import <doc> $(git ls-files site) --base site');
  }
  if (requested.length > MAX_FILES_PER_DOC) {
    throw new DesignDocError('limit', `a design doc holds at most ${MAX_FILES_PER_DOC} files; import fewer`);
  }
  const files = projectFiles(caller, 'import');
  const base = localPath(files, stringFlag(flags, 'base') ?? '.', ctx.cwd);
  if (!isInside(base, files.root)) throw new DesignDocError('invalid', `--base must be inside the project folder ${files.root}`);

  const picked = new Map<string, string>();
  const skipped: string[] = [];
  for (const raw of requested) {
    const absolute = localPath(files, raw, ctx.cwd);
    if (absolute === resolve(base) || !isInside(absolute, base)) {
      throw new DesignDocError('invalid', `${raw} is not inside ${base}; pass --base <folder> that holds every file`);
    }
    const path = relative(base, absolute).split(sep).join('/');
    const reason = importSkipReason(path);
    if (reason) skipped.push(`${path} (${reason})`);
    else picked.set(path, absolute);
  }
  if (picked.size === 0) throw new DesignDocError('invalid', `nothing to import; skipped ${skipped.join(', ')}`);

  let bytes = 0;
  const read = await mapBounded([...picked], FILE_CONCURRENCY, async ([path, absolute]) => {
    let file: LocalFile;
    try {
      file = await deps.readLocalFile({ files, path: absolute });
    } catch (error) {
      throw new Error(`cannot read ${path}: ${errorText(error)}`);
    }
    bytes += file.sizeBytes;
    if (bytes > MAX_DOC_BYTES) {
      throw new DesignDocError('limit', `these files add up to more than a design doc holds (${formatBytes(MAX_DOC_BYTES)})`);
    }
    return { path, content: file.content, encoding: file.encoding };
  });

  const note = stringFlag(flags, 'note') ?? 'Imported';
  const entry = stringFlag(flags, 'entry');
  const skippedLine = skipped.length > 0 ? [`Skipped ${skipped.length}: ${skipped.join(', ')}`] : [];
  if (!target) {
    const detail = deps.store.create(
      {
        title: title!,
        summary: stringFlag(flags, 'summary'),
        projectId: flags.global === true ? null : caller.projectId,
        files: read,
        // A folder with both is a site with a README for its repository.
        entryPath: entry ?? read.find((file) => file.path.toLowerCase() === 'index.html')?.path
      },
      caller.actor
    );
    deps.changed(detail.id);
    return [
      `Created design doc ${detail.id} ("${detail.title}") from ${read.length} files; it opens on ${detail.entryPath}.`,
      ...skippedLine,
      `Preview: zcc design-docs preview ${detail.slug}`
    ].join('\n');
  }
  const results = deps.store.writeFiles(
    target.id,
    read.map((file) => ({ ...file, note })),
    caller.actor
  );
  if (entry !== undefined) deps.store.update(target.id, { entryPath: entry }, caller.actor);
  deps.changed(target.id);
  const created = results.filter((result) => result.created).length;
  const doc = deps.store.summary(target.id);
  return [
    `Imported ${results.length} files into ${doc.slug} (${doc.id}): ${created} new, ${results.length - created} updated or unchanged. It opens on ${doc.entryPath}.`,
    ...skippedLine
  ].join('\n');
}

/**
 * The doc as the folder a static host serves: its files, the kit its pages
 * load, and `.nojekyll`. Files already in the folder that the doc does not
 * have stay; nothing is deleted.
 */
async function exportSite(
  deps: CliDeps,
  caller: CliCaller,
  docId: string,
  flags: ParsedArgs['flags'],
  ctx: PluginCliContext
): Promise<string> {
  const out = stringFlag(flags, 'out');
  if (!out) throw new DesignDocError('invalid', '--out needs the folder to write the site into');
  if (!deps.writeLocalFile) throw new DesignDocError('invalid', 'export --out is not available here');
  const files = projectFiles(caller, 'export --out');
  const folder = localPath(files, out, ctx.cwd);
  if (!isInside(folder, files.root)) throw new DesignDocError('invalid', `--out must be inside the project folder ${files.root}`);
  const doc = deps.store.summary(docId);
  const own = deps.store.readAllFiles(doc.id);
  const site = siteFiles(own, deps.kit ?? NO_KIT);
  const writeLocalFile = deps.writeLocalFile;
  await mapBounded(site, FILE_CONCURRENCY, async (file) => {
    try {
      await writeLocalFile({ files, path: join(folder, file.path), content: file.content, encoding: file.encoding });
    } catch (error) {
      throw new Error(`cannot write ${file.path}: ${errorText(error)}`);
    }
  });
  const added = site.slice(own.length).map((file) => file.path);
  const hasPages = own.some((file) => file.kind === 'html');
  return [
    `Exported ${doc.slug} to ${folder}: ${own.length} doc files${added.length > 0 ? `, plus ${added.join(', ')}` : ''}.`,
    'Files already there that the doc does not have were left in place.',
    ...(hasPages
      ? [
          `It opens on ${doc.entryPath}${doc.entryPath === 'index.html' ? '' : '; a static host serves index.html first, so add one or link to it'}.`,
          'GitHub Pages: commit the folder, then in the repository settings under Pages, deploy from a branch and pick it (it must be the root or /docs).'
        ]
      : [])
  ].join('\n');
}

export function registerDesignDocCli(zcc: Pick<ZccPluginApi, 'cli'>, deps: CliDeps): void {
  zcc.cli.register({
    name: CLI_NAME,
    summary: 'Read and edit design docs (specs, RFCs, ADRs) shared with your agents',
    commands: CLI_COMMANDS.map((command) => ({ ...command })),
    run: (argv, ctx) => runCli(deps, argv, ctx)
  });
}

function isInside(path: string, root: string): boolean {
  const base = resolve(root);
  const target = resolve(path);
  return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/** The registered project whose folder holds `cwd`, the deepest one if nested. */
function projectContaining<T extends { path?: string }>(projects: T[], cwd: string | undefined): T | undefined {
  if (!cwd) return undefined;
  return projects
    .filter((project) => project.path && isInside(cwd, project.path))
    .sort((a, b) => b.path!.length - a.path!.length)[0];
}

/**
 * The CLI's caller, from records the host owns. The thread id and cwd arrive
 * from the caller's environment, so neither grants anything by itself: a
 * thread must exist (its project and host then come from the thread), and a
 * cwd only counts inside a registered project.
 */
export function createCliCaller(
  sdk: Pick<ZccPluginApi['sdk'], 'threads' | 'projects' | 'environments'>,
  actorFor: (threadId: string) => Promise<DocActor>
): CliDeps['caller'] {
  return async (ctx) => {
    const thread = ctx.threadId ? await sdk.threads.get({ threadId: ctx.threadId }).catch(() => null) : null;
    const projects = await sdk.projects.list().catch(() => []);
    if (thread) {
      const environment = thread.environmentId
        ? await sdk.environments.get({ environmentId: thread.environmentId }).catch(() => null)
        : null;
      const root = environment?.path ?? projects.find((project) => project.id === thread.projectId)?.path ?? null;
      return {
        actor: await actorFor(thread.id),
        projectId: thread.projectId,
        files: root ? { hostId: thread.hostId, root } : null
      };
    }
    // No thread row: the user's own shell, or a CLI Agent's terminal session.
    const project = projectContaining(projects, ctx.cwd);
    return {
      actor: ctx.threadId ? { kind: 'agent', label: CLI_AGENT_LABEL, threadId: null } : CLI_USER,
      projectId: ctx.projectId ?? project?.id ?? null,
      files: project?.path ? { root: project.path } : null
    };
  };
}

/** Read a file on the caller's host, confined to its project root. */
export function createLocalFileReader(sdk: Pick<ZccPluginApi['sdk'], 'files'>): CliDeps['readLocalFile'] {
  return async ({ files, path, cwd }) => {
    const result = await sdk.files.read({
      ...(files.hostId ? { hostId: files.hostId } : {}),
      path: localPath(files, path, cwd),
      rootPath: files.root
    });
    return { content: result.content, encoding: result.contentEncoding, sizeBytes: result.sizeBytes };
  };
}

/** Write a file on the caller's host, confined to its project root. */
export function createLocalFileWriter(sdk: Pick<ZccPluginApi['sdk'], 'files'>): NonNullable<CliDeps['writeLocalFile']> {
  return async ({ files, path, content, encoding }) => {
    await sdk.files.write({
      ...(files.hostId ? { hostId: files.hostId } : {}),
      path,
      rootPath: files.root,
      content,
      contentEncoding: encoding,
      createParents: true
    });
  };
}

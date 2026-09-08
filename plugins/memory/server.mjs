import {
  CliError,
  MEMORY_KINDS,
  MEMORY_SCHEMA,
  MEMORY_USAGE,
  MemoryStore,
  isMemoryKind,
  option,
  parseArgv,
  renderCatalog,
  validateTags
} from './src/memory-store.js';

function jsonOutput(value) {
  return JSON.stringify(value, null, 2);
}

function displayMemory(memory, includeDetails) {
  const tags = memory.tags.length > 0 ? ` tags=${memory.tags.join(',')}` : '';
  const lines = [
    `${memory.id} v${memory.version} [${memory.scope}/${memory.kind}] ${memory.name}`,
    `  ${memory.summary}`,
    `  importance=${memory.importance} pinned=${memory.pinned}${tags}`
  ];
  if (includeDetails) {
    lines.push('', memory.details, '', `Reason: ${memory.writeReason}`);
  }
  return lines.join('\n');
}

function requireOption(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new CliError(`missing required --${name}`);
  return value;
}

function envProjectId(args) {
  return option(args, 'project') || process.env.ZCC_PROJECT_ID || undefined;
}

function writeScope(args) {
  const value = requireOption(args, 'scope');
  if (value === 'global') return { scope: 'global', projectId: null };
  if (value !== 'project') throw new CliError('write scope must be project or global');
  const projectId = envProjectId(args);
  if (!projectId) {
    throw new CliError('project-scoped memory requires --project <id> or ZCC_PROJECT_ID');
  }
  return { scope: 'project', projectId };
}

export default function plugin(zcc) {
  const db = zcc.storage.database();
  db.migrate(MEMORY_SCHEMA);
  const store = new MemoryStore(db);

  zcc.rpc.method('listMemories', () => ({ memories: store.listAll() }));
  zcc.rpc.method('updateMemory', (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const memory = store.update(String(record.id ?? ''), {
      expectedVersion: Number(record.expectedVersion),
      summary: record.summary,
      details: record.details,
      kind: record.kind,
      tags: Array.isArray(record.tags) ? record.tags : undefined,
      importance: typeof record.importance === 'number' ? record.importance : undefined,
      pinned: typeof record.pinned === 'boolean' ? record.pinned : undefined,
      writeReason: 'Edited in Memory settings'
    });
    return { memory };
  });
  zcc.rpc.method('deleteMemory', (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const memory = store.forget(
      String(record.id ?? ''),
      Number(record.expectedVersion),
      'Deleted in Memory settings'
    );
    return { deleted: { id: memory.id, version: memory.version } };
  });

  zcc.agents.configure((ctx) => ({
    instructions: renderCatalog(store, ctx.projectId),
    skills: ['memory']
  }));

  zcc.cli.register({
    name: 'memory',
    summary: 'Read and maintain durable global and project memories',
    commands: [
      { name: 'catalog', summary: 'List compact memory summaries', usage: 'zcc memory catalog [--scope all|project|global] [--json]' },
      { name: 'search', summary: 'Search memory summaries and details', usage: 'zcc memory search <query...> [--json]' },
      { name: 'get', summary: 'Read one complete memory', usage: 'zcc memory get <id-or-name> [--json]' },
      { name: 'add', summary: 'Save a project or global memory', usage: 'zcc memory add --scope project|global --name NAME --summary TEXT --details TEXT --reason TEXT [options]' },
      { name: 'update', summary: 'Update a memory with version checking', usage: 'zcc memory update <id> --expected-version N --reason TEXT [options]' },
      { name: 'forget', summary: 'Soft-delete a memory with version checking', usage: 'zcc memory forget <id> --expected-version N --reason TEXT' },
      { name: 'history', summary: 'Show a memory\'s version history', usage: 'zcc memory history <id> [--limit N] [--json]' }
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (!command || command === 'help' || command === '--help') {
        return { exitCode: 0, stdout: MEMORY_USAGE };
      }
      try {
        const args = parseArgv(rest);
        const wantsJson = args.flags.has('json');
        if (command === 'catalog' || command === 'list') {
          const scope = option(args, 'scope') ?? 'all';
          const memories = store.list(scope, envProjectId(args), 40);
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, scope, memories })
              : memories.map((memory) => displayMemory(memory, false)).join('\n') || 'No memories.'
          };
        }
        if (command === 'search') {
          const query = args.positionals.join(' ').trim();
          if (!query) throw new CliError('search requires a query');
          const memories = store.search(query);
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, query, memories })
              : memories.map((memory) => displayMemory(memory, false)).join('\n') || 'No matches.'
          };
        }
        if (command === 'get') {
          const idOrName = args.positionals[0];
          if (!idOrName) throw new CliError('get requires an id or name');
          const memory = store.get(idOrName);
          if (!memory) throw new CliError(`memory "${idOrName}" was not found`);
          return {
            exitCode: 0,
            stdout: wantsJson ? jsonOutput({ ok: true, memory }) : displayMemory(memory, true)
          };
        }
        if (command === 'add') {
          const scoped = writeScope(args);
          const kind = option(args, 'kind') ?? 'fact';
          if (!isMemoryKind(kind)) throw new CliError(`kind must be one of: ${MEMORY_KINDS.join(', ')}`);
          const memory = store.add({
            ...scoped,
            name: requireOption(args, 'name'),
            summary: requireOption(args, 'summary'),
            details: requireOption(args, 'details'),
            kind,
            tags: args.options.get('tag') ?? [],
            importance: option(args, 'importance') === undefined ? 50 : Number(option(args, 'importance')),
            pinned: args.flags.has('pinned'),
            writeReason: requireOption(args, 'reason')
          });
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, memory })
              : `Saved ${memory.id} v${memory.version} (${memory.scope}/${memory.name}).`
          };
        }
        if (command === 'update') {
          const id = args.positionals[0];
          if (!id) throw new CliError('update requires a memory id');
          const memory = store.update(id, {
            expectedVersion: Number(requireOption(args, 'expected-version')),
            summary: option(args, 'summary'),
            details: option(args, 'details'),
            kind: option(args, 'kind'),
            tags: args.options.has('tag') ? validateTags(args.options.get('tag')) : undefined,
            pinned: option(args, 'pinned') === undefined ? undefined : option(args, 'pinned') === 'true',
            writeReason: requireOption(args, 'reason')
          });
          return {
            exitCode: 0,
            stdout: wantsJson ? jsonOutput({ ok: true, memory }) : `Updated ${memory.id} to v${memory.version}.`
          };
        }
        if (command === 'forget') {
          const id = args.positionals[0];
          if (!id) throw new CliError('forget requires a memory id');
          const memory = store.forget(id, Number(requireOption(args, 'expected-version')), requireOption(args, 'reason'));
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, forgotten: { id: memory.id, version: memory.version } })
              : `Forgot ${memory.id} at v${memory.version}.`
          };
        }
        if (command === 'history') {
          const id = args.positionals[0];
          if (!id) throw new CliError('history requires a memory id');
          const rawLimit = option(args, 'limit');
          const limit = rawLimit === undefined ? 20 : Number(rawLimit);
          if (!Number.isInteger(limit) || limit < 1) throw new CliError('limit must be a positive integer');
          const history = store.history(id, limit);
          if (history.length === 0) throw new CliError(`memory history for "${id}" was not found`);
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, id, history })
              : history
                  .map((entry) => `v${entry.version} ${entry.action} — ${entry.writeReason}`)
                  .join('\n')
          };
        }
        throw new CliError(`unknown subcommand "${command}"\n${MEMORY_USAGE}`);
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    }
  });
}

import {
  CliError,
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  MEMORY_KINDS,
  MEMORY_SCHEMA,
  MEMORY_USAGE,
  MemoryStore,
  option,
  parseArgv,
  parseBoolean,
  parseInteger,
  parseKind,
  readScope,
  renderCatalog,
  requireOption,
  resolveProjectId,
  toMemorySummary,
  validateTags,
  writeScope
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
    lines.push(
      '',
      memory.details,
      '',
      `Reason: ${memory.writeReason}`,
      `Source thread: ${memory.sourceThreadId ?? 'none'}`
    );
  }
  return lines.join('\n');
}

export default function plugin(zcc) {
  const db = zcc.storage.database();
  db.migrate(MEMORY_SCHEMA);
  const store = new MemoryStore(db);

  zcc.rpc.method('listMemories', () => ({ memories: store.listAll() }));
  zcc.rpc.method('updateMemory', (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const id = String(record.id ?? '');
    const current = store.getAdmin(id);
    if (!current) throw new Error(`memory "${id}" was not found`);
    const kindValue = record.kind;
    if (kindValue !== undefined && !MEMORY_KINDS.includes(kindValue)) {
      throw new Error(`kind must be one of: ${MEMORY_KINDS.join(', ')}`);
    }
    const memory = store.update(
      id,
      {
        expectedVersion: Number(record.expectedVersion),
        summary: record.summary,
        details: record.details,
        kind: kindValue,
        tags: Array.isArray(record.tags) ? record.tags : undefined,
        importance: typeof record.importance === 'number' ? record.importance : undefined,
        pinned: typeof record.pinned === 'boolean' ? record.pinned : undefined,
        sourceThreadId: null,
        writeReason: 'Edited in Memory settings'
      },
      current.projectId ?? undefined
    );
    return { memory };
  });
  zcc.rpc.method('deleteMemory', (input) => {
    const record = input && typeof input === 'object' ? input : {};
    const id = String(record.id ?? '');
    const current = store.getAdmin(id);
    if (!current) throw new Error(`memory "${id}" was not found`);
    const memory = store.forget(
      id,
      Number(record.expectedVersion),
      'Deleted in Memory settings',
      null,
      current.projectId ?? undefined
    );
    return { deleted: { id: memory.id, version: memory.version } };
  });

  zcc.agents.contributeInstructions(({ projectId }) => renderCatalog(store, projectId));

  zcc.cli.register({
    name: 'memory',
    summary: 'Read and maintain durable global and project memories',
    commands: [
      {
        name: 'catalog',
        summary: 'List compact memory summaries',
        usage: 'zcc memory catalog [--scope all|project|global] [--limit N] [--json]'
      },
      {
        name: 'search',
        summary: 'Search memory summaries and details',
        usage: 'zcc memory search <query...> [--scope all|project|global] [--limit N] [--json]'
      },
      {
        name: 'get',
        summary: 'Read one complete memory',
        usage: 'zcc memory get <id-or-name> [--scope all|project|global] [--json]'
      },
      {
        name: 'add',
        summary: 'Save a project or global memory',
        usage:
          'zcc memory add --scope project|global --name NAME --summary TEXT --details TEXT --reason TEXT [options]'
      },
      {
        name: 'update',
        summary: 'Update a memory with version checking',
        usage: 'zcc memory update <id> --expected-version N --reason TEXT [options]'
      },
      {
        name: 'forget',
        summary: 'Soft-delete a memory with version checking',
        usage: 'zcc memory forget <id> --expected-version N --reason TEXT'
      },
      {
        name: 'history',
        summary: "Show a memory's version history",
        usage: 'zcc memory history <id> [--limit N] [--json]'
      }
    ],
    async run(argv, ctx = {}) {
      const [command, ...rest] = argv;
      if (!command || command === 'help' || command === '--help') {
        return { exitCode: 0, stdout: MEMORY_USAGE };
      }
      try {
        const args = parseArgv(rest);
        const wantsJson = args.flags.has('json');
        const projectId = resolveProjectId(args, ctx);
        if (command === 'catalog' || command === 'list') {
          const scope = readScope(args);
          const limit = parseInteger('limit', option(args, 'limit'), {
            defaultValue: DEFAULT_RESULT_LIMIT,
            min: 1,
            max: MAX_RESULT_LIMIT
          });
          const result = store.list(scope, projectId, limit);
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({
                  ok: true,
                  scope,
                  memories: result.memories.map(toMemorySummary),
                  total: result.total
                })
              : result.memories.map((memory) => displayMemory(memory, false)).join('\n') ||
                'No memories.'
          };
        }
        if (command === 'search') {
          const query = args.positionals.join(' ').trim();
          if (!query) throw new CliError('search requires a query');
          const scope = readScope(args);
          const limit = parseInteger('limit', option(args, 'limit'), {
            defaultValue: DEFAULT_RESULT_LIMIT,
            min: 1,
            max: MAX_RESULT_LIMIT
          });
          const memories = store.search(query, scope, projectId, limit);
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({
                  ok: true,
                  query,
                  scope,
                  memories: memories.map(toMemorySummary)
                })
              : memories.map((memory) => displayMemory(memory, false)).join('\n') || 'No matches.'
          };
        }
        if (command === 'get') {
          const idOrName = args.positionals[0];
          if (!idOrName) throw new CliError('get requires an id or name');
          const memory = store.get(idOrName, readScope(args), projectId);
          if (!memory) {
            throw new CliError(`memory "${idOrName}" was not found in the current scope`);
          }
          return {
            exitCode: 0,
            stdout: wantsJson ? jsonOutput({ ok: true, memory }) : displayMemory(memory, true)
          };
        }
        if (command === 'add') {
          const scoped = writeScope(args, ctx);
          const memory = store.add({
            ...scoped,
            name: requireOption(args, 'name'),
            summary: requireOption(args, 'summary'),
            details: requireOption(args, 'details'),
            kind: parseKind(option(args, 'kind')),
            tags: args.options.get('tag') ?? [],
            importance: parseInteger('importance', option(args, 'importance'), {
              defaultValue: 50,
              min: 0,
              max: 100
            }),
            pinned: args.flags.has('pinned'),
            sourceThreadId: ctx.threadId ?? null,
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
          const tags = args.options.has('tag') ? validateTags(args.options.get('tag')) : undefined;
          const importance = args.options.has('importance')
            ? parseInteger('importance', option(args, 'importance'), { min: 0, max: 100 })
            : undefined;
          const kind = args.options.has('kind') ? parseKind(option(args, 'kind')) : undefined;
          const pinned = parseBoolean('pinned', option(args, 'pinned'));
          if (
            !args.options.has('summary') &&
            !args.options.has('details') &&
            kind === undefined &&
            tags === undefined &&
            importance === undefined &&
            pinned === undefined
          ) {
            throw new CliError('update requires at least one field to change');
          }
          const memory = store.update(
            id,
            {
              expectedVersion: parseInteger(
                'expected-version',
                requireOption(args, 'expected-version'),
                { min: 1, max: Number.MAX_SAFE_INTEGER }
              ),
              summary: option(args, 'summary'),
              details: option(args, 'details'),
              kind,
              tags,
              importance,
              pinned,
              sourceThreadId: ctx.threadId ?? null,
              writeReason: requireOption(args, 'reason')
            },
            projectId
          );
          return {
            exitCode: 0,
            stdout: wantsJson
              ? jsonOutput({ ok: true, memory })
              : `Updated ${memory.id} to v${memory.version}.`
          };
        }
        if (command === 'forget') {
          const id = args.positionals[0];
          if (!id) throw new CliError('forget requires a memory id');
          const memory = store.forget(
            id,
            parseInteger('expected-version', requireOption(args, 'expected-version'), {
              min: 1,
              max: Number.MAX_SAFE_INTEGER
            }),
            requireOption(args, 'reason'),
            ctx.threadId ?? null,
            projectId
          );
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
          const limit = parseInteger('limit', option(args, 'limit'), {
            defaultValue: DEFAULT_RESULT_LIMIT,
            min: 1,
            max: MAX_RESULT_LIMIT
          });
          const history = store.history(id, projectId, limit);
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

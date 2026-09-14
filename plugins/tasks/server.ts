import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import {
  createTask,
  dueFromFlag,
  findTask,
  formatHelp,
  formatTaskListLine,
  applyBoardMove,
  isTaskStatus,
  LEGACY_ITEMS_KEY,
  MAX_TASKS,
  normalizeStore,
  parseCliArgs,
  patchTask,
  priorityFromFlag,
  statusFromFlag,
  STORAGE_KEY,
  TASKS_CHANGED,
  toPublic,
  toggleDone,
  type PublicTask,
  type Task,
  type TaskStore
} from './src/model.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readId(args: unknown): string {
  const row = asRecord(args);
  const value = row.id ?? row.key;
  return typeof value === 'string' ? value.trim() : '';
}

export default function plugin(zcc: ZccPluginApi) {
  async function load(): Promise<TaskStore> {
    const current = await zcc.storage.kv.get(STORAGE_KEY);
    if (current != null) return normalizeStore(current);
    const legacy = await zcc.storage.kv.get(LEGACY_ITEMS_KEY);
    return normalizeStore(legacy);
  }

  async function persist(store: TaskStore): Promise<TaskStore> {
    await zcc.storage.kv.set(STORAGE_KEY, store);
    zcc.realtime.publish(TASKS_CHANGED, { count: store.items.length });
    return store;
  }

  function requireTask(store: TaskStore, idOrKey: string): Task {
    const task = findTask(store, idOrKey);
    if (!task) throw new Error(`task not found: ${idOrKey}`);
    return task;
  }

  function replace(store: TaskStore, next: Task): TaskStore {
    return {
      ...store,
      items: store.items.map((item) => (item.id === next.id ? next : item))
    };
  }

  zcc.rpc.method('list', async () => {
    const store = await load();
    return { items: store.items.map(toPublic) };
  });

  zcc.rpc.method('get', async (args) => {
    const store = await load();
    return { task: toPublic(requireTask(store, readId(args))) };
  });

  zcc.rpc.method('add', async (args) => {
    const row = asRecord(args);
    const store = await load();
    if (store.items.length >= MAX_TASKS) throw new Error(`task limit is ${MAX_TASKS}`);
    const { task, nextSeq } = createTask(
      {
        title: typeof row.title === 'string' ? row.title : '',
        description: typeof row.description === 'string' ? row.description : '',
        status: statusFromFlag(typeof row.status === 'string' ? row.status : undefined),
        priority: priorityFromFlag(typeof row.priority === 'string' ? row.priority : undefined),
        dueDate: dueFromFlag(typeof row.dueDate === 'string' ? row.dueDate : undefined) ?? null
      },
      { nextSeq: store.nextSeq }
    );
    await persist({ version: store.version, nextSeq, items: [...store.items, task] });
    return toPublic(task);
  });

  zcc.rpc.method('update', async (args) => {
    const row = asRecord(args);
    const store = await load();
    const current = requireTask(store, readId(args));
    const next = patchTask(current, {
      title: typeof row.title === 'string' ? row.title : undefined,
      description: typeof row.description === 'string' ? row.description : undefined,
      status: statusFromFlag(typeof row.status === 'string' ? row.status : undefined),
      priority: priorityFromFlag(typeof row.priority === 'string' ? row.priority : undefined),
      dueDate: dueFromFlag(typeof row.dueDate === 'string' ? row.dueDate : row.dueDate === null ? 'clear' : undefined),
      order: typeof row.order === 'number' ? row.order : undefined
    });
    await persist(replace(store, next));
    return toPublic(next);
  });

  zcc.rpc.method('toggle', async (args) => {
    const store = await load();
    const next = toggleDone(requireTask(store, readId(args)));
    await persist(replace(store, next));
    return toPublic(next);
  });

  zcc.rpc.method('remove', async (args) => {
    const store = await load();
    const current = requireTask(store, readId(args));
    await persist({ ...store, items: store.items.filter((item) => item.id !== current.id) });
    return { ok: true, id: current.id };
  });

  zcc.rpc.method('boardMove', async (args) => {
    const row = asRecord(args);
    const id = readId(args);
    const status = statusFromFlag(typeof row.status === 'string' ? row.status : undefined);
    if (!status || !isTaskStatus(status)) throw new Error('status is required');
    const index = typeof row.index === 'number' && Number.isFinite(row.index) ? row.index : 0;
    const store = await load();
    requireTask(store, id);
    const items = applyBoardMove(store.items, findTask(store, id)!.id, status, index);
    await persist({ ...store, items });
    const moved = findTask({ ...store, items }, id);
    return { task: moved ? toPublic(moved) : null };
  });

  zcc.rpc.method('badge', async () => {
    const store = await load();
    const count = store.items.filter((task) => task.status !== 'done' && task.status !== 'canceled').length;
    return { count: count > 0 ? count : null };
  });

  zcc.ui.registerMentionProvider({
    id: 'task',
    label: 'Tasks',
    async search(ctx) {
      const store = await load();
      const query = typeof ctx === 'string' ? ctx : ctx.query;
      const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
      return store.items
        .filter(
          (task) =>
            !needle ||
            task.title.toLowerCase().includes(needle) ||
            task.key.toLowerCase().includes(needle) ||
            task.id.includes(needle)
        )
        .slice(0, 20)
        .map((task) => ({
          id: task.id,
          label: `${task.key} ${task.title}`,
          insertText: `::task{key="${task.key}"}`
        }));
    },
    async resolve(itemId) {
      const store = await load();
      const task = requireTask(store, itemId);
      return {
        context: [
          `# ${task.key} ${task.title}`,
          '',
          `Status: ${task.status}`,
          `Priority: ${task.priority}`,
          task.dueDate ? `Due: ${task.dueDate}` : '',
          '',
          task.description || '_No description._',
          '',
          'Act on this task with `zcc tasks` (list / show / update / done).'
        ]
          .filter((line) => line !== '')
          .join('\n')
      };
    }
  });

  zcc.cli.register({
    name: 'tasks',
    summary: 'Plan and track work',
    commands: [
      { name: 'list', summary: 'List tasks', usage: 'zcc tasks list [--status] [--priority]' },
      { name: 'add', summary: 'Add a task', usage: 'zcc tasks add <title>' },
      { name: 'show', summary: 'Show a task', usage: 'zcc tasks show <key-or-id>' },
      { name: 'update', summary: 'Update a task', usage: 'zcc tasks update <key-or-id>' },
      { name: 'done', summary: 'Toggle done', usage: 'zcc tasks done <key-or-id>' }
    ],
    async run(argv) {
      const parsed = parseCliArgs(argv);
      if (parsed.help || parsed.command === 'help') {
        return { exitCode: 0, stdout: formatHelp() };
      }
      try {
        if (parsed.command === 'list') {
          const store = await load();
          const status = statusFromFlag(parsed.flags.status);
          const priority = priorityFromFlag(parsed.flags.priority);
          const items = store.items.filter((task) => {
            if (status && task.status !== status) return false;
            if (priority && task.priority !== priority) return false;
            return true;
          });
          if (items.length === 0) return { exitCode: 0, stdout: 'No tasks.\n' };
          return {
            exitCode: 0,
            stdout: `${items.map(formatTaskListLine).join('\n')}\n`
          };
        }
        if (parsed.command === 'add') {
          const title = parsed.rest.join(' ').trim();
          if (!title) return { exitCode: 2, stderr: 'zcc tasks add requires a title\n' };
          const store = await load();
          if (store.items.length >= MAX_TASKS) {
            return { exitCode: 2, stderr: `task limit is ${MAX_TASKS}\n` };
          }
          const { task, nextSeq } = createTask(
            {
              title,
              status: statusFromFlag(parsed.flags.status),
              priority: priorityFromFlag(parsed.flags.priority),
              dueDate: dueFromFlag(parsed.flags.due) ?? null
            },
            { nextSeq: store.nextSeq }
          );
          await persist({ version: store.version, nextSeq, items: [...store.items, task] });
          return { exitCode: 0, stdout: `${task.key}  ${task.title}\n` };
        }
        if (parsed.command === 'show') {
          const id = parsed.rest[0];
          if (!id) return { exitCode: 2, stderr: 'zcc tasks show requires a key\n' };
          const store = await load();
          const task = findTask(store, id);
          if (!task) return { exitCode: 3, stderr: `task not found: ${id}\n` };
          const lines = [
            `${task.key}  ${task.title}`,
            `status    ${task.status}`,
            `priority  ${task.priority}`,
            task.dueDate ? `due       ${task.dueDate}` : null,
            task.description ? `\n${task.description}` : null,
            ''
          ].filter((line): line is string => line !== null);
          return { exitCode: 0, stdout: `${lines.join('\n')}\n` };
        }
        if (parsed.command === 'update') {
          const id = parsed.rest[0];
          if (!id) return { exitCode: 2, stderr: 'zcc tasks update requires a key\n' };
          const store = await load();
          const current = findTask(store, id);
          if (!current) return { exitCode: 3, stderr: `task not found: ${id}\n` };
          const next = patchTask(current, {
            title: parsed.flags.title,
            status: statusFromFlag(parsed.flags.status),
            priority: priorityFromFlag(parsed.flags.priority),
            dueDate: dueFromFlag(parsed.flags.due)
          });
          await persist(replace(store, next));
          return { exitCode: 0, stdout: `${next.key}  ${next.status}  ${next.title}\n` };
        }
        if (parsed.command === 'done') {
          const id = parsed.rest[0];
          if (!id) return { exitCode: 2, stderr: 'zcc tasks done requires a key\n' };
          const store = await load();
          const current = findTask(store, id);
          if (!current) return { exitCode: 3, stderr: `task not found: ${id}\n` };
          const next = toggleDone(current);
          await persist(replace(store, next));
          return { exitCode: 0, stdout: `${next.status}  ${next.key}  ${next.title}\n` };
        }
        return { exitCode: 2, stderr: `unknown command: ${parsed.command}; run zcc tasks --help\n` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 2, stderr: `${message}\n` };
      }
    }
  });
}

export type { PublicTask };

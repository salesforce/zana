/** Official Tasks plugin — panel + `zcc tasks` + skill. */
export default function plugin(zcc) {
  const KEY = 'items';

  async function all() {
    return (await zcc.storage.kv.get(KEY)) ?? [];
  }

  async function save(items) {
    await zcc.storage.kv.set(KEY, items);
    return items;
  }

  zcc.rpc.method('list', async () => ({ items: await all() }));
  zcc.rpc.method('add', async (args) => {
    const title = typeof args?.title === 'string' ? args.title.trim() : '';
    if (!title) throw new Error('title is required');
    const items = await all();
    const item = { id: `${Date.now()}`, title, done: false };
    items.push(item);
    await save(items);
    return item;
  });
  zcc.rpc.method('toggle', async (args) => {
    const id = typeof args?.id === 'string' ? args.id : '';
    const items = await all();
    const item = items.find((row) => row.id === id);
    if (!item) throw new Error('task not found');
    item.done = !item.done;
    await save(items);
    return item;
  });

  zcc.ui.registerMentionProvider({
    id: 'task',
    label: 'Tasks',
    async search({ query }) {
      const items = await all();
      const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
      return items
        .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.id.includes(needle))
        .slice(0, 20)
        .map((item) => ({
          id: item.id,
          label: item.title,
          insertText: `@${item.title}`
        }));
    },
    async resolve(itemId) {
      const items = await all();
      const item = items.find((row) => row.id === itemId);
      if (!item) throw new Error(`unknown task: ${itemId}`);
      return {
        context: [
          `# Task ${item.title}`,
          '',
          `Status: ${item.done ? 'done' : 'open'}`,
          `Id: ${item.id}`,
          '',
          'Act on this task with `zcc tasks` (list / add / done).'
        ].join('\n')
      };
    }
  });

  zcc.cli.register({
    name: 'tasks',
    summary: 'Plan and track work',
    commands: [
      { name: 'list', summary: 'List tasks', usage: 'zcc tasks list' },
      { name: 'add', summary: 'Add a task', usage: 'zcc tasks add <title>' },
      { name: 'done', summary: 'Toggle a task', usage: 'zcc tasks done <id>' }
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (!command || command === 'list' || command === '--help' || command === '-h') {
        const items = await all();
        if (command === '--help' || command === '-h') {
          return {
            exitCode: 0,
            stdout: 'zcc tasks list\nzcc tasks add <title>\nzcc tasks done <id>\n'
          };
        }
        if (items.length === 0) return { exitCode: 0, stdout: 'No tasks.\n' };
        return {
          exitCode: 0,
          stdout: items.map((item) => `${item.done ? 'x' : ' '} ${item.id}  ${item.title}`).join('\n') + '\n'
        };
      }
      if (command === 'add') {
        const title = rest.join(' ').trim();
        if (!title) return { exitCode: 2, stderr: 'zcc tasks add requires a title\n' };
        const items = await all();
        const created = { id: `${Date.now()}`, title, done: false };
        items.push(created);
        await save(items);
        return { exitCode: 0, stdout: `${created.id}  ${created.title}\n` };
      }
      if (command === 'done') {
        const id = rest[0];
        if (!id) return { exitCode: 2, stderr: 'zcc tasks done requires an id\n' };
        const items = await all();
        const item = items.find((row) => row.id === id);
        if (!item) return { exitCode: 3, stderr: `task not found: ${id}\n` };
        item.done = !item.done;
        await save(items);
        return { exitCode: 0, stdout: `${item.done ? 'done' : 'open'}  ${item.id}  ${item.title}\n` };
      }
      return { exitCode: 2, stderr: `unknown command: ${command}; run zcc tasks --help\n` };
    }
  });
}

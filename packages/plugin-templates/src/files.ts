import type { PluginStarterKind } from './kinds.js';

export interface PluginScaffoldFiles {
  id: string;
  name: string;
  description: string;
  kind: PluginStarterKind;
  zccVersion: string;
  pluginSdkVersion: string;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function claudeMd(opts: PluginScaffoldFiles): string {
  const hasServer = opts.kind !== 'panel';
  const hasApp = opts.kind !== 'agent-preset';
  const isTodos = opts.kind === 'main-panel';
  return `# ${opts.name} plugin

This is a Zana Command Center plugin. The manifest lives in \`package.json\` → \`zcc\`.
Id: \`${opts.id}\`.

## Loop

\`\`\`bash
zcc plugin install .
\`\`\`

After install the plugin is live. Then, only as needed:

${isTodos ? '- `npm test` — unit tests, no running app.\n' : ''}- Backend edits: \`zcc plugin reload ${opts.id}\` (\`zcc plugin dev\` optional).
- UI (\`zcc.app\`) edits: \`zcc plugin dev\` (watch) or \`zcc plugin build\` then \`reload\`.
- Compile check: \`zcc plugin build\` (no running app).

\`zcc plugin dev\` is an optional watch loop **after** a path install. It is not required to create or run a plugin. Path installs load \`server.ts\` from source. A failed rebuild keeps the last good generation. Plugins are full-trust in-process on the server after install. Do not request host-daemon tokens.
Fill the host panel slot (\`height: 100%\`). Skills live in \`skills/<name>/SKILL.md\`.
MCP servers belong in \`zcc.mcpServers\`. Author against \`@zana-ai/zcc-plugin-sdk\` (\`definePluginApp\`, \`ZccPluginApi\`).

${hasApp ? 'The panel is a `definePluginApp` setup that registers `app.slots.navPanel`.' : 'This starter has no app slot — add `zcc.app` if you need a panel.'}
${hasServer ? 'The server factory default-exports `(zcc) => { … }` and registers `zcc.rpc` methods the panel can call after a reload.' : 'This starter is app-only — add `zcc.server` if you need a backend.'}
`;
}

function readmeMd(opts: PluginScaffoldFiles): string {
  const isTodos = opts.kind === 'main-panel';
  return `# ${opts.name}

\`\`\`bash
zcc plugin install .
\`\`\`

After install the plugin is live.${isTodos ? ' Then `npm test` (no running app).' : ''} Backend: \`zcc plugin reload ${opts.id}\`. UI watch: optional \`zcc plugin dev\`. Compile: \`zcc plugin build\`.
`;
}

function skillMd(opts: PluginScaffoldFiles): string {
  if (opts.kind === 'main-panel') {
    return `---
name: ${opts.id}
description: Manage the ${opts.name} example todo list via \`zcc ${opts.id}\`.
---

Use \`zcc ${opts.id} list\` and \`zcc ${opts.id} add <title>\` (or \`zcc plugin run ${opts.id} …\`) when the user asks about this plugin's todos.
`;
  }
  return `---
name: ${opts.id}
description: Sample skill shipped by the ${opts.name} plugin.
---

Use this skill when the user asks about ${opts.name}.
`;
}

function serverTs(opts: PluginScaffoldFiles): string {
  return `import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  zcc.log.info('${opts.id} loaded');
  zcc.rpc.method('ping', () => ({ ok: true, pluginId: zcc.pluginId }));
}
`;
}

function mcpServerTs(opts: PluginScaffoldFiles): string {
  return `import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export default function plugin(zcc: ZccPluginApi) {
  zcc.log.info('${opts.id} loaded — replace zcc.mcpServers placeholder with a real server id');
  zcc.rpc.method('ping', () => ({ ok: true, pluginId: zcc.pluginId }));
}
`;
}

function todosServerTs(opts: PluginScaffoldFiles): string {
  return `import { randomUUID } from 'node:crypto';
import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';

export type Todo = { id: string; title: string; done: boolean };

const TODOS_CHANGED = 'todos-changed';

export default async function plugin(zcc: ZccPluginApi) {
  zcc.log.info('${opts.id} loaded');
  const settings = zcc.settings.define({
    showDone: { type: 'boolean', label: 'Show completed todos', default: true }
  });
  const { showDone } = await settings.get();

  async function readTodos(): Promise<Todo[]> {
    return (await zcc.storage.kv.get<Todo[]>('todos')) ?? [];
  }
  async function writeTodos(todos: Todo[]): Promise<void> {
    await zcc.storage.kv.set('todos', todos);
    zcc.realtime.publish(TODOS_CHANGED, { count: todos.length });
  }
  async function listTodos(): Promise<Todo[]> {
    const todos = await readTodos();
    return showDone ? todos : todos.filter((todo) => !todo.done);
  }
  async function addTodo(title: string): Promise<Todo> {
    const todo: Todo = { id: randomUUID().slice(0, 8), title, done: false };
    await writeTodos([...(await readTodos()), todo]);
    return todo;
  }
  async function toggleTodo(id: string): Promise<Todo | null> {
    const todos = await readTodos();
    const todo = todos.find((candidate) => candidate.id === id);
    if (!todo) return null;
    todo.done = !todo.done;
    await writeTodos(todos);
    return todo;
  }

  zcc.rpc.method('list', () => listTodos());
  zcc.rpc.method('add', (args) => {
    const title = typeof args === 'object' && args && 'title' in args ? String(args.title).trim() : '';
    if (!title) throw new Error('title is required');
    return addTodo(title);
  });
  zcc.rpc.method('toggle', async (args) => {
    const id = typeof args === 'object' && args && 'id' in args ? String(args.id) : '';
    const todo = await toggleTodo(id);
    if (!todo) throw new Error(\`no todo \${id}\`);
    return todo;
  });

  const usage = ['Usage:', '  zcc ${opts.id} list', '  zcc ${opts.id} add <title>'].join('\\n');
  zcc.cli.register({
    name: '${opts.id}',
    summary: 'Manage the ${opts.name} example todo list',
    commands: [
      { name: 'list', summary: 'List todos', usage: 'zcc ${opts.id} list' },
      { name: 'add', summary: 'Add a todo', usage: 'zcc ${opts.id} add <title>' }
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (command === 'list') {
        const todos = await listTodos();
        return {
          exitCode: 0,
          stdout: todos.length === 0 ? 'No todos.' : todos.map((todo) => \`[\${todo.done ? 'x' : ' '}] \${todo.title}\`).join('\\n')
        };
      }
      if (command === 'add') {
        const title = rest.join(' ').trim();
        if (!title) return { exitCode: 1, stderr: usage };
        const todo = await addTodo(title);
        return { exitCode: 0, stdout: \`Added \${todo.title}\` };
      }
      return { exitCode: 1, stderr: usage };
    }
  });
}
`;
}

function appTsx(opts: PluginScaffoldFiles): string {
  return `import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';

function Panel() {
  const React = (globalThis as { __ZCC_HOST_REACT__?: typeof import('react') }).__ZCC_HOST_REACT__;
  if (!React) return null;
  return React.createElement(
    'div',
    { style: { padding: 24, height: '100%', boxSizing: 'border-box' } },
    React.createElement('h2', { style: { marginTop: 0 } }, ${JSON.stringify(opts.name)}),
    React.createElement(
      'p',
      { style: { color: 'var(--text-muted)', fontSize: 13 } },
      'Your plugin is live. Edit app.tsx and reload.'
    )
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: ${JSON.stringify(opts.name)},
    icon: 'Puzzle',
    component: Panel
  });
});
`;
}

function todosAppTsx(opts: PluginScaffoldFiles): string {
  return `import { useEffect, useState, type FormEvent } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@zana-ai/zcc-plugin-sdk/app';

type Todo = { id: string; title: string; done: boolean };

function TodosPanel() {
  const rpc = useRpc();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refetch = () => {
    void rpc
      .call('list')
      .then((value) => {
        setTodos(Array.isArray(value) ? (value as Todo[]) : []);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  useEffect(() => {
    refetch();
  }, [rpc]);
  useRealtime('todos-changed', refetch);

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    const next = title.trim();
    if (!next) return;
    setTitle('');
    void rpc.call('add', { title: next }).then(refetch, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <div style={{ padding: 24, height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ marginTop: 0 }}>${opts.name}</h2>
      <form onSubmit={onAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a todo"
          aria-label="Todo title"
        />
        <button type="submit">Add</button>
      </form>
      {error ? <p>{error}</p> : null}
      {todos === null ? (
        <p>Loading…</p>
      ) : todos.length === 0 ? (
        <p>No todos yet</p>
      ) : (
        <ul>
          {todos.map((todo) => (
            <li key={todo.id}>
              <label>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => {
                    void rpc.call('toggle', { id: todo.id }).then(refetch);
                  }}
                />{' '}
                {todo.title}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'main',
    title: ${JSON.stringify(opts.name)},
    icon: 'ListTodo',
    component: TodosPanel
  });
});
`;
}

function appJs(opts: PluginScaffoldFiles): string {
  return `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.navPanel({
      id: 'main',
      title: ${JSON.stringify(opts.name)},
      icon: 'Puzzle',
      component: function Panel() {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement(
          'div',
          { style: { padding: 24, height: '100%', boxSizing: 'border-box' } },
          React.createElement('h2', { style: { marginTop: 0 } }, ${JSON.stringify(opts.name)}),
          React.createElement(
            'p',
            { style: { color: 'var(--text-muted)', fontSize: 13 } },
            'Your plugin is live. Edit app.tsx and reload.'
          )
        );
      }
    });
  }
};
`;
}

function serverTest(opts: PluginScaffoldFiles): string {
  return `import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';

const { zcc, harness } = createFakePluginHost({ pluginId: ${JSON.stringify(opts.id)} });

export async function testPing() {
  const plugin = (await import('./server.ts')).default;
  await plugin(zcc);
  return harness.callRpc('ping');
}
`;
}

function todosServerTest(opts: PluginScaffoldFiles): string {
  return `import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin from './server.ts';

describe('${opts.id} server', () => {
  it('lists, adds, toggles, and runs CLI', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: ${JSON.stringify(opts.id)} });
    await plugin(zcc);
    await expect(harness.callRpc('list')).resolves.toEqual([]);
    const added = (await harness.callRpc('add', { title: 'Milk' })) as { id: string; title: string; done: boolean };
    expect(added.title).toBe('Milk');
    expect(added.done).toBe(false);
    await expect(harness.callRpc('list')).resolves.toEqual([added]);
    const toggled = (await harness.callRpc('toggle', { id: added.id })) as { done: boolean };
    expect(toggled.done).toBe(true);
    const listed = await harness.runCli(['list']);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('Milk');
    const created = await harness.runCli(['add', 'Eggs']);
    expect(created.stdout).toContain('Eggs');
  });
});
`;
}

function appTest(opts: PluginScaffoldFiles): string {
  return `import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import definition from './app.js';

export function testPanel() {
  const set = collectTestPluginApp(definition, ${JSON.stringify(opts.id)});
  if (set.navPanels.length !== 1) throw new Error('expected a nav panel');
  return set.navPanels[0].title;
}
`;
}

function todosAppTest(opts: PluginScaffoldFiles): string {
  return `// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@zana-ai/zcc-plugin-sdk/testing/app';

const app = await loadPluginApp(() => import('./app.tsx'), ${JSON.stringify(opts.id)});

describe('${opts.id} app', () => {
  it('renders todos from rpc', async () => {
    const slot = renderSlot(app.navPanels[0]!, { pluginId: ${JSON.stringify(opts.id)}, subPath: '' }, {
      rpc: {
        list: () => [{ id: '1', title: 'Milk', done: false }]
      }
    });
    await slot.findByText('Milk');
    expect(slot.inspection.rpcCalls).toEqual([{ method: 'list', input: null }]);
  });

  it('shows the empty state', async () => {
    const slot = renderSlot(app.navPanels[0]!, { pluginId: ${JSON.stringify(opts.id)}, subPath: '' }, {
      rpc: { list: () => [] }
    });
    await slot.findByText('No todos yet');
  });
});
`;
}

function todosVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['*.test.ts', '*.test.tsx']
  }
});
`;
}

function packageJson(
  opts: PluginScaffoldFiles,
  zcc: Record<string, unknown>,
  extra?: { scripts?: Record<string, string>; devDependencies?: Record<string, string> }
): string {
  return json({
    name: `zcc-plugin-${opts.id}`,
    version: '0.1.0',
    type: 'module',
    engines: {
      zcc: `>=${opts.zccVersion}`,
      zccPluginSdk: `>=${opts.pluginSdkVersion}`
    },
    zcc,
    ...(extra?.scripts ? { scripts: extra.scripts } : {}),
    devDependencies: {
      '@zana-ai/zcc-plugin-sdk': opts.pluginSdkVersion,
      ...extra?.devDependencies
    }
  });
}

function tsconfigJson(include: string[]): string {
  return json({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: true,
      noEmit: true
    },
    include
  });
}

export function pluginScaffoldFileMap(opts: PluginScaffoldFiles): Record<string, string> {
  const files: Record<string, string> = {
    'README.md': readmeMd(opts),
    'CLAUDE.md': claudeMd(opts)
  };

  if (opts.kind === 'panel') {
    files['tsconfig.json'] = tsconfigJson(['server.ts', 'app.tsx']);
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      app: './app.tsx',
      skills: ['skills']
    });
    files['app.tsx'] = appTsx(opts);
    files['app.js'] = appJs(opts);
  } else if (opts.kind === 'mcp-consumer') {
    files['tsconfig.json'] = tsconfigJson(['server.ts', 'app.tsx']);
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      server: './server.ts',
      app: './app.tsx',
      skills: ['skills'],
      mcpServers: {
        example: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'example-mcp-server'],
          alwaysOn: false
        }
      },
      extra: {
        notes: 'Replace zcc.mcpServers.example with a real MCP server before relying on it.'
      }
    });
    files['server.ts'] = mcpServerTs(opts);
    files['app.tsx'] = appTsx(opts);
    files['app.js'] = appJs(opts);
  } else if (opts.kind === 'agent-preset') {
    files['tsconfig.json'] = tsconfigJson(['server.ts', 'app.tsx']);
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      server: './server.ts',
      skills: ['skills']
    });
    files['server.ts'] = serverTs(opts);
  } else {
    files['tsconfig.json'] = tsconfigJson(['server.ts', 'app.tsx', 'server.test.ts', 'app.test.tsx']);
    files['package.json'] = packageJson(
      opts,
      {
        name: opts.name,
        description: opts.description,
        branding: { icon: 'ListTodo' },
        server: './server.ts',
        app: './app.tsx',
        skills: ['skills']
      },
      {
        scripts: { test: 'vitest run' },
        devDependencies: {
          '@testing-library/react': '^16.3.2',
          '@types/react': '^19.0.0',
          jsdom: '^26.1.0',
          react: '^19.2.8',
          'react-dom': '^19.2.8',
          vitest: '^4.1.10'
        }
      }
    );
    files['server.ts'] = todosServerTs(opts);
    files['app.tsx'] = todosAppTsx(opts);
    files['server.test.ts'] = todosServerTest(opts);
    files['app.test.tsx'] = todosAppTest(opts);
    files['vitest.config.ts'] = todosVitestConfig();
  }

  files[`skills/${opts.id}/SKILL.md`] = skillMd(opts);
  if (opts.kind !== 'panel' && opts.kind !== 'main-panel') files['server.test.js'] = serverTest(opts);
  if (opts.kind !== 'agent-preset' && opts.kind !== 'main-panel') files['app.test.js'] = appTest(opts);
  return files;
}

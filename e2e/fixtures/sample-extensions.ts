/**
 * Inline sample-extension trees for E2E git-daemon installs.
 * Specs pass these as `files` maps rather than copying a disk fixture tree.
 */

export const HELLO_SAMPLE_FILES: Record<string, string> = {
  'extension.json': JSON.stringify(
    {
      id: 'hello-sample',
      version: '1.0.0',
      title: 'Hello Sample',
      icon: 'Sparkles',
      titleLabel: 'Hello Sample',
      entry: { main: 'main.mjs', renderer: 'renderer.js' },
      engines: { zccApi: '^1.0.0' },
      permissions: ['storage'],
      projectTab: { label: 'Hello', icon: 'Sparkles', order: 100, global: true },
    },
    null,
    2
  ),
  'main.mjs': `export default {
  id: 'hello-sample',
  setup(ctx) {
    ctx.log('hello-sample: main process activated');
    return {
      ping: async () => ({ ok: true, message: 'pong from hello-sample' }),
      getStatus: async () => ({ ok: true, id: 'hello-sample', version: '1.0.0', loaded: true }),
    };
  },
};
`,
  'renderer.js': `export default {
  id: 'hello-sample',
  renderGlobal({ host }) {
    const container = document.createElement('div');
    container.className = 'hello-sample-container';
    const button = document.createElement('button');
    button.textContent = 'Test Ping';
    button.onclick = async () => { await host.call('ping'); };
    container.appendChild(button);
    return container;
  },
  renderProjectTab({ projectId }) {
    const container = document.createElement('div');
    container.className = 'hello-sample-project';
    container.textContent = String(projectId);
    return container;
  },
};
`,
};

export const INBOX_PUSH_SAMPLE_FILES: Record<string, string> = {
  'extension.json': JSON.stringify(
    {
      id: 'inbox-push-sample',
      version: '1.0.0',
      title: 'Inbox Push Sample',
      icon: 'Bell',
      titleLabel: 'Inbox Push Sample',
      entry: { main: 'main.mjs', renderer: 'renderer.js' },
      engines: { zccApi: '^1.0.0' },
      permissions: ['inbox:push'],
      projectTab: { label: 'Inbox Push Sample', icon: 'Bell', order: 100, global: true },
    },
    null,
    2
  ),
  'main.mjs': `export default {
  id: 'inbox-push-sample',
  setup(ctx) {
    ctx.log('inbox-push-sample: main process activated');
    return {
      push: async (input) => {
        const res = await ctx.inbox.push(input);
        ctx.log(\`inbox-push-sample: pushed \${res.id}\`);
        return res;
      },
    };
  },
};
`,
  'renderer.js': `export default {
  activate({ React }) {
    return function Panel() {
      return React.createElement('div', { className: 'inbox-push-sample-panel' }, 'Inbox Push Sample');
    };
  },
};
`,
};

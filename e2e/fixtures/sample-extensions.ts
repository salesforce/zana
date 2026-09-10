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
  'package.json': JSON.stringify(
    {
      name: 'inbox-push-sample',
      version: '1.0.0',
      type: 'module',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'inbox-push-sample',
        description: 'Inbox push E2E fixture',
        branding: { icon: 'Bell' },
        server: './server.mjs'
      }
    },
    null,
    2
  ),
  'server.mjs': `export default function plugin(zcc) {
  zcc.rpc.method('push', async (input) => zcc.sdk.inbox.push(input));
}
`,
};

/** Modern `package.json` `zcc` plugin — no leftover `extension.json`. */
export const ZCC_PLUGIN_SAMPLE_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'zcc-plugin-git-hello',
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'git-hello',
        description: 'git hello plugin',
        branding: { icon: 'Puzzle' },
        server: './server.mjs'
      }
    },
    null,
    2
  ),
  'server.mjs': `export default function plugin(zcc) {
  zcc.rpc.method('ping', () => ({ ok: true, id: zcc.pluginId }));
}
`
};

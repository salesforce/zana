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
  return `# ${opts.name} plugin

This is a Zana Command Center plugin. The manifest lives in \`package.json\` → \`zcc\`.
Id: \`${opts.id}\`.

## Loop

1. Edit \`server.ts\` / \`app.tsx\` (or the generated \`.mjs\` / \`.js\` entries).
2. Reload with **Reload from source** in Plugins, or call \`install_local_extension\`.
3. From a shell: \`zcc plugin dev .\` watches, rebuilds, and reloads.

Plugins are full-trust in-process on the server after install. Do not request host-daemon tokens.
Fill the host panel slot (\`height: 100%\`). Skills live in \`skills/<name>/SKILL.md\`.
MCP servers belong in \`zcc.mcpServers\`. Author against \`@zana-ai/zcc-plugin-sdk\` (\`definePluginApp\`, \`ZccPluginApi\`).

${hasApp ? 'The panel is a `definePluginApp` setup that registers `app.slots.navPanel`.' : 'This starter has no app slot — add `zcc.app` if you need a panel.'}
${hasServer ? 'The server factory default-exports `(zcc) => { … }` and registers `zcc.rpc` methods the panel can call after a reload.' : 'This starter is app-only — add `zcc.server` if you need a backend.'}
`;
}

function skillMd(opts: PluginScaffoldFiles): string {
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

function serverMjs(opts: PluginScaffoldFiles): string {
  return `/** @typedef {import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi} ZccPluginApi */
export default function plugin(zcc) {
  zcc.log.info(${JSON.stringify(`${opts.id} loaded`)});
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

function mcpServerMjs(opts: PluginScaffoldFiles): string {
  return `/** @typedef {import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi} ZccPluginApi */
export default function plugin(zcc) {
  zcc.log.info(${JSON.stringify(`${opts.id} loaded — replace zcc.mcpServers placeholder with a real server id`)});
  zcc.rpc.method('ping', () => ({ ok: true, pluginId: zcc.pluginId }));
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
  const plugin = (await import('./server.mjs')).default;
  await plugin(zcc);
  return harness.callRpc('ping');
}
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

function packageJson(opts: PluginScaffoldFiles, zcc: Record<string, unknown>): string {
  return json({
    name: `zcc-plugin-${opts.id}`,
    version: '0.1.0',
    type: 'module',
    engines: {
      zcc: `>=${opts.zccVersion}`,
      zccPluginSdk: `>=${opts.pluginSdkVersion}`
    },
    zcc
  });
}

export function pluginScaffoldFileMap(opts: PluginScaffoldFiles): Record<string, string> {
  const files: Record<string, string> = {
    'README.md': `# ${opts.name}\n\nInstall with \`zcc plugin install .\` then \`zcc plugin dev .\`.\n`,
    'CLAUDE.md': claudeMd(opts),
    'tsconfig.json': json({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true
      },
      include: ['server.ts', 'app.tsx']
    })
  };

  if (opts.kind === 'panel') {
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      app: './app.js',
      skills: ['skills']
    });
    files['app.tsx'] = appTsx(opts);
    files['app.js'] = appJs(opts);
  } else if (opts.kind === 'mcp-consumer') {
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      server: './server.mjs',
      app: './app.js',
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
    files['server.mjs'] = mcpServerMjs(opts);
    files['app.tsx'] = appTsx(opts);
    files['app.js'] = appJs(opts);
  } else if (opts.kind === 'agent-preset') {
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      server: './server.mjs',
      skills: ['skills']
    });
    files['server.ts'] = serverTs(opts);
    files['server.mjs'] = serverMjs(opts);
  } else {
    files['package.json'] = packageJson(opts, {
      name: opts.name,
      description: opts.description,
      branding: { icon: 'Puzzle' },
      server: './server.mjs',
      app: './app.js',
      skills: ['skills']
    });
    files['server.ts'] = serverTs(opts);
    files['server.mjs'] = serverMjs(opts);
    files['app.tsx'] = appTsx(opts);
    files['app.js'] = appJs(opts);
  }

  files[`skills/${opts.id}/SKILL.md`] = skillMd(opts);
  if (opts.kind !== 'panel') files['server.test.js'] = serverTest(opts);
  if (opts.kind !== 'agent-preset') files['app.test.js'] = appTest(opts);
  return files;
}

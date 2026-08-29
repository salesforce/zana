import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../plugins');

function pkg(id, name, description, icon, extra = {}) {
  return `${JSON.stringify({
    name: `@zcc-ext/${id}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    description,
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: {
      name,
      description,
      branding: { icon },
      server: './server.mjs',
      app: './app.js',
      ...extra
    }
  }, null, 2)}\n`;
}

function testFile(id, extraIts) {
  return `import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { derivePluginId, readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.mjs';
import app from '../app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('${id} plugin', () => {
  it('derives a stable id', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(derivePluginId(pkg.name)).toBe('${id}');
    expect(readPluginManifest(pkg).appEntry).toBe('./app.js');
  });

  it('loads against the fake host', async () => {
    const { zcc } = createFakePluginHost({ pluginId: '${id}' });
    await plugin(zcc);
  });

  it('registers its app slots', () => {
    const set = collectTestPluginApp(app, '${id}');
    ${extraIts}
  });
});
`;
}

function writePlugin(id, files) {
  const dir = join(root, id);
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
}

const panel = (title) => `function Panel(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement(
          'div',
          { style: { padding: 24 }, 'data-plugin-panel': props.pluginId },
          React.createElement('h2', { style: { marginTop: 0 } }, ${JSON.stringify(title)}),
          props.subPath
            ? React.createElement('p', null, props.subPath)
            : React.createElement('p', { style: { color: 'var(--text-muted)' } }, 'Ready.')
        );
      }`;

writePlugin('github', {
  'package.json': pkg('github', 'GitHub', 'Browse issues and pull requests from a nested plugin panel.', 'Github'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.log.info('github plugin loaded');
  zcc.rpc.method('status', async () => ({ ok: true }));
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    ${panel('GitHub')}
    app.slots.navPanel({
      id: 'issues',
      title: 'GitHub',
      icon: 'Github',
      path: 'issues',
      component: Panel
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('github', `expect(set.navPanels[0]?.path).toBe('issues');`)
});

writePlugin('workflows', {
  'package.json': pkg('workflows', 'Workflows', 'Inspect and open saved workflow runs.', 'Workflow'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.rpc.method('list', async () => ({ items: (await zcc.storage.kv.get('items')) ?? [] }));
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    ${panel('Workflows')}
    app.slots.navPanel({
      id: 'main',
      title: 'Workflows',
      icon: 'Workflow',
      component: Panel
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('workflows', `expect(set.navPanels[0]?.title).toBe('Workflows');`)
});

writePlugin('side-chat', {
  'package.json': pkg('side-chat', 'Side chat', 'Open a compact ThreadChat panel beside the current thread.', 'MessagesSquare'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.log.info('side-chat plugin loaded');
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.threadPanelAction({
      id: 'chat',
      title: 'Side chat',
      icon: 'MessagesSquare',
      layout: 'flush',
      component: function SideChat(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        const ThreadChat = globalThis.__ZCC_PLUGIN_RUNTIME__?.ThreadChat;
        if (!React) return null;
        if (!ThreadChat) {
          return React.createElement('p', { style: { padding: 16 } }, 'Side chat is unavailable.');
        }
        return React.createElement(ThreadChat, { threadId: props.threadId, variant: 'compact' });
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('side-chat', `expect(set.threadPanelActions[0]?.id).toBe('chat');`)
});

writePlugin('inline-vis', {
  'package.json': pkg('inline-vis', 'Inline vis', 'Render ::chart{title} leaves in assistant messages.', 'ChartColumn'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.log.info('inline-vis plugin loaded');
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.messageDirective({
      id: 'chart',
      component: function Chart(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement(
          'div',
          { className: 'plugin-inline-vis', 'data-testid': 'plugin-inline-vis' },
          React.createElement('strong', null, props.attributes.title ?? 'Chart'),
          React.createElement('pre', null, props.source)
        );
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('inline-vis', `expect(set.messageDirectives[0]?.id).toBe('chart');`)
});

writePlugin('automations', {
  'package.json': pkg('automations', 'Automations', 'Named cron jobs with a Settings section.', 'Timer'),
  'server.mjs': `export default function plugin(zcc) {
  const settings = zcc.settings.define({
    enabled: { type: 'boolean', label: 'Run hourly sweep', default: false }
  });
  zcc.background.schedule('hourly-sweep', '0 * * * *', async () => {
    const values = await settings.get();
    if (!values.enabled) return;
    await zcc.storage.kv.set('lastRun', Date.now());
  });
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'automations',
      title: 'Automations',
      description: 'Named cron jobs owned by this plugin.',
      component: function Section(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement('p', null, 'Hourly sweep is configured in plugin settings.', props.pluginId);
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('automations', `expect(set.settingsSections[0]?.id).toBe('automations');`)
});

writePlugin('memory', {
  'package.json': pkg('memory', 'Memory', 'Standing notes contributed to later threads, with @memory mentions.', 'Brain'),
  'server.mjs': `export default function plugin(zcc) {
  const settings = zcc.settings.define({
    notes: { type: 'string', label: 'Memory notes', default: '' }
  });
  const apply = async () => {
    const values = await settings.get();
    zcc.agents.contributeInstructions(typeof values.notes === 'string' ? values.notes : '');
  };
  settings.onChange(() => {
    void apply();
  });
  void apply();
  zcc.agents.configure(async () => {
    const values = await settings.get();
    const text = typeof values.notes === 'string' ? values.notes.trim() : '';
    return text ? { instructions: text } : {};
  });
  zcc.ui.registerMentionProvider({
    id: 'memory',
    label: 'Memory',
    search: async (ctx) => {
      const query = typeof ctx === 'string' ? ctx : ctx.query;
      const values = await settings.get();
      const notes = typeof values.notes === 'string' ? values.notes : '';
      if (!notes.trim()) return [];
      if (query && !notes.toLowerCase().includes(query.toLowerCase())) return [];
      return [{ id: 'notes', label: 'Memory notes', insertText: notes.slice(0, 80) }];
    },
    resolve: async () => {
      const values = await settings.get();
      const notes = typeof values.notes === 'string' ? values.notes.trim() : '';
      if (!notes) throw new Error('memory notes are empty');
      return { context: `# Memory notes\n\n${notes}` };
    }
  });
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'memory',
      title: 'Memory',
      component: function Section(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement('p', null, 'Notes live in plugin settings.', props.pluginId);
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('memory', `expect(set.settingsSections[0]?.id).toBe('memory');`)
});

writePlugin('secrets', {
  'package.json': pkg('secrets', 'Secrets', 'Host-local secret string settings. Values never appear in the plugin snapshot.', 'KeyRound'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.settings.define({
    token: { type: 'string', label: 'Secret token', secret: true, default: '' }
  });
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'secrets',
      title: 'Secrets',
      component: function Section(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement('p', null, 'Store a secret token for this host.', props.pluginId);
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('secrets', `expect(set.settingsSections[0]?.id).toBe('secrets');`)
});

writePlugin('keep-awake', {
  'package.json': pkg('keep-awake', 'Keep awake', 'Ask the host to stay awake while ZCC is open.', 'Coffee', { host: './host.mjs' }),
  'host.mjs': `export default function setup(api) {
  api.methods.register('keep-awake', (input) => ({ ok: true, enabled: Boolean(input?.enabled) }));
}
`,
  'server.mjs': `export default function plugin(zcc) {
  const settings = zcc.settings.define({
    enabled: { type: 'boolean', label: 'Keep this machine awake', default: false }
  });
  zcc.background.service('keep-awake', () => {
    const timer = setInterval(() => {
      void settings.get().then((values) => {
        if (!values.enabled) return;
        return zcc.host.experimental_call('keep-awake', { enabled: true }).catch(() => undefined);
      });
    }, 30_000);
    return () => clearInterval(timer);
  });
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'keep-awake',
      title: 'Keep awake',
      component: function Section(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        return React.createElement('p', null, 'Uses zcc.host.experimental_call when enabled.', props.pluginId);
      }
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('keep-awake', `expect(set.settingsSections[0]?.id).toBe('keep-awake');`)
});

writePlugin('connect', {
  'package.json': pkg('connect', 'Connect', 'Host pairing helper shown as a Settings section and homepage card.', 'Cable'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.log.info('connect plugin loaded');
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    ${panel('Connect')}
    app.slots.settingsSection({
      id: 'connect',
      title: 'Connect',
      component: Panel
    });
    app.slots.homepageSection({
      id: 'connect',
      title: 'Host access',
      component: Panel
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('connect', `expect(set.settingsSections[0]?.id).toBe('connect');\n    expect(set.homepageSections[0]?.id).toBe('connect');`)
});

writePlugin('provider-retry', {
  'package.json': pkg('provider-retry', 'Provider retry', 'Composer action that appends a retry instruction to the draft.', 'RotateCcw'),
  'server.mjs': `export default function plugin(zcc) {
  zcc.log.info('provider-retry plugin loaded');
}
`,
  'app.js': `export default {
  __zccPluginApp: true,
  setup(app) {
    app.composer.customize({
      id: 'retry',
      plusMenu: [
        {
          id: 'retry',
          label: 'Retry last turn',
          icon: 'RotateCcw',
          run({ composer }) {
            composer.updateText((current) =>
              current.trim() ? current : 'Retry the last turn with the same tools.'
            );
          }
        }
      ]
    });
  }
};
`,
  'src/plugin-contract.test.ts': testFile('provider-retry', `expect(set.composerCustomizations[0]?.id).toBe('retry');`)
});

console.log('wrote official plugins');

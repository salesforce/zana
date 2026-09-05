import type { ComponentType } from 'react';
import { definePluginApp, useZccContext, useZccNavigate, type PluginCreateProjectDialogProps, type PluginPendingInteractionProps } from '@zana-ai/zcc-plugin-sdk/app';
import { AgentforcePlaygroundPanel } from './src/app/AgentScriptPanel.js';
import { AgentforcePreviewPanel } from './src/app/AgentforcePreviewPanel.js';
import { SalesforceProjectTab } from './src/app/SalesforceProjectTab.js';
import { SoqlExplorerPanel } from './src/app/soql/SoqlExplorerPanel.js';
import { openAgentforcePlayground, openAgentforcePreview } from './src/app/agentforce-panel-params.js';

function hostReact() {
  return (globalThis as { __ZCC_HOST_REACT__?: typeof import('react') }).__ZCC_HOST_REACT__;
}

function pluginHost() {
  return (globalThis as { __ZCC_PLUGIN_HOST__?: { callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown> } })
    .__ZCC_PLUGIN_HOST__;
}

function SalesforceGuardrailForm(props: PluginPendingInteractionProps) {
  const React = hostReact();
  if (!React) return null;
  const payload =
    props.interaction.payload && typeof props.interaction.payload === 'object'
      ? (props.interaction.payload as Record<string, string>)
      : {};
  return React.createElement(
    'div',
    { style: { display: 'grid', gap: 8 } },
    React.createElement('p', { style: { margin: 0 } }, payload.summary || 'Confirm this Salesforce action.'),
    payload.orgAlias
      ? React.createElement(
          'p',
          { style: { margin: 0, color: 'var(--text-muted)' } },
          `${payload.orgAlias} · ${payload.orgKind || 'unknown'}${payload.orgId ? ` · ${payload.orgId}` : ''}`
        )
      : null,
    payload.preview
      ? React.createElement(
          'pre',
          { style: { whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', margin: 0 } },
          String(payload.preview)
        )
      : null,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8 } },
      React.createElement(
        'button',
        { type: 'button', onClick: () => void props.submit({ approved: true }) },
        'Allow this action'
      ),
      React.createElement('button', { type: 'button', onClick: () => void props.cancel() }, 'Deny')
    )
  );
}

function SalesforceComposerBanner(props: { pluginId?: string }) {
  const React = hostReact();
  if (!React) return null;
  const [status, setStatus] = React.useState<null | Record<string, unknown>>(null);
  React.useEffect(() => {
    let cancelled = false;
    pluginHost()
      ?.callRpc(props.pluginId || 'salesforce', 'status')
      .then((next) => {
        if (!cancelled) setStatus(next as Record<string, unknown>);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.pluginId]);
  if (!status) return null;
  const last = status.lastDoctor as { org?: { kind?: string }; agentBundleCount?: number } | undefined;
  const kind = last?.org?.kind;
  const target = (typeof status.selectedAlias === 'string' && status.selectedAlias) || (typeof status.defaultOrg === 'string' && status.defaultOrg) || '';
  const orgs = Array.isArray(status.orgs) ? status.orgs : [];
  if (!target && status.dxProject) {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      orgs.length > 0
        ? 'Salesforce: pick a CLI-connected org on the Salesforce tab. Family tools share that target.'
        : 'Salesforce: set a default org alias under Plugins → Salesforce, then run zcc sf doctor.'
    );
  }
  if (kind === 'production') {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      `Salesforce: target org ${target} is production. Org reads, anonymous Apex, and Agentforce publish/activate require confirmation.`
    );
  }
  if (kind === 'unknown') {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      `Salesforce: target org ${target} kind is unknown. Access and Agentforce publish/activate require confirmation.`
    );
  }
  if ((last?.agentBundleCount ?? 0) > 0) {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      'Salesforce: Agentforce publish/activate requires confirmation.'
    );
  }
  return null;
}

function AgentFileOpener(props: {
  pluginId: string;
  path: string;
  source?: { threadId: string | null; projectId: string | null };
  experimental_Original: ComponentType;
}) {
  const React = hostReact();
  const navigate = useZccNavigate();
  const context = useZccContext();
  if (!React) return null;
  const Original = props.experimental_Original;
  const canOpen = Boolean(context.threadId);
  return React.createElement(
    'div',
    { className: 'salesforce-agent-opener', style: { display: 'grid', gap: 8, padding: 8 } },
    React.createElement('p', { style: { margin: 0, color: 'var(--text-muted)' } }, props.path),
    React.createElement(
      'button',
      {
        type: 'button',
        disabled: !canOpen,
        onClick: () => {
          openAgentforcePlayground({
            openThreadPanel: (options) => navigate.openThreadPanel(options),
            projectId: context.projectId ?? props.source?.projectId,
            path: props.path
          });
        }
      },
      'Open in Playground'
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        disabled: !canOpen,
        onClick: () => {
          openAgentforcePreview({
            openThreadPanel: (options) => navigate.openThreadPanel(options),
            path: props.path
          });
        }
      },
      'Open in Preview'
    ),
    canOpen
      ? null
      : React.createElement(
          'p',
          { style: { margin: 0, color: 'var(--text-muted)' } },
          'Open a thread to use the Agentforce Playground or Preview side panel.'
        ),
    React.createElement(Original)
  );
}

function CreateSalesforceProjectDialog(props: PluginCreateProjectDialogProps) {
  const React = hostReact();
  if (!React) return null;
  const [name, setName] = React.useState('');
  const [outputDir, setOutputDir] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    props
      .cloneRoot()
      .then((root) => {
        if (!cancelled && root) setOutputDir(root);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Default the parent folder once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- host passes fresh closures each render
  }, []);
  const canSubmit = name.trim().length > 0 && outputDir.trim().length > 0 && !busy;
  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    pluginHost()
      ?.callRpc(props.pluginId, 'project.generate', { name: name.trim(), outputDir: outputDir.trim() })
      .then(async (raw) => {
        const result = raw as { ok?: boolean; path?: string; error?: string };
        if (!result?.ok || !result.path) {
          throw new Error(result?.error || 'Could not generate the Salesforce project.');
        }
        const project = await props.addProject(result.path);
        if (!project) throw new Error('Generated the DX folder, but could not add it as a project.');
        props.toProject(project.id, { tabId: 'salesforce' });
        props.close();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };
  const onNameChange = (event: { currentTarget: { value: string } }) => {
    setName(event.currentTarget.value);
    if (error) setError(null);
  };
  const onDirChange = (event: { currentTarget: { value: string } }) => {
    setOutputDir(event.currentTarget.value);
    if (error) setError(null);
  };
  const onEnter = (event: { key: string }) => {
    if (event.key === 'Enter') submit();
  };
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: 'modal-hint' },
      'Creates a Salesforce DX project with ',
      React.createElement('code', null, 'sf project generate'),
      ', then adds it to ZCC.'
    ),
    React.createElement(
      'label',
      { className: 'remote-form-row local-path-row' },
      React.createElement('span', null, 'Project name'),
      React.createElement('input', {
        value: name,
        onChange: onNameChange,
        onKeyDown: onEnter,
        placeholder: 'MyDxProject',
        disabled: busy,
        autoFocus: true,
        spellCheck: false,
        autoCapitalize: 'off',
        autoCorrect: 'off'
      })
    ),
    React.createElement(
      'label',
      { className: 'remote-form-row local-path-row' },
      React.createElement('span', null, 'Parent folder'),
      React.createElement(
        'div',
        { className: 'local-path-input-group' },
        React.createElement('input', {
          value: outputDir,
          onChange: onDirChange,
          onKeyDown: onEnter,
          placeholder: '~/zcc-workspace',
          disabled: busy,
          spellCheck: false,
          autoCapitalize: 'off',
          autoCorrect: 'off'
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'btn',
            disabled: busy,
            'aria-label': 'Browse for folder',
            onClick: () => {
              void props.pickDirectory().then((picked) => {
                if (picked) setOutputDir(picked);
              });
            }
          },
          'Browse…'
        )
      )
    ),
    error ? React.createElement('div', { className: 'modal-error' }, error) : null,
    React.createElement(
      'div',
      { className: 'plugin-create-project-actions' },
      React.createElement(
        'button',
        { type: 'button', className: 'btn', disabled: busy, onClick: () => props.close() },
        'Cancel'
      ),
      React.createElement(
        'button',
        { type: 'button', className: 'btn primary', disabled: !canSubmit, onClick: submit },
        busy ? 'Creating…' : 'Create project'
      )
    )
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: 'agent',
    title: 'Agentforce Playground',
    extensions: ['agent', 'afscript'],
    component: AgentFileOpener
  });
  app.slots.projectTab({
    id: 'salesforce',
    label: 'Salesforce',
    icon: 'Cloud',
    order: 80,
    global: false,
    component: SalesforceProjectTab
  });
  app.slots.projectTab({
    id: 'soql',
    label: 'SOQL',
    icon: 'Database',
    order: 82,
    global: false,
    component: SoqlExplorerPanel
  });
  app.slots.experimental_projectMenuAction({
    id: 'open-soql',
    title: 'SOQL',
    icon: 'Database',
    placement: 'project',
    run: (ctx) => {
      if (!ctx.projectId) return;
      ctx.toProject(ctx.projectId, { tabId: 'soql' });
    }
  });
  app.slots.threadPanelAction({
    id: 'playground',
    title: 'Playground',
    icon: 'FileCode',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: AgentforcePlaygroundPanel
  });
  app.slots.threadPanelAction({
    id: 'preview',
    title: 'Preview',
    icon: 'MessageSquare',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: AgentforcePreviewPanel
  });
  app.slots.experimental_newThreadPanelAction({
    id: 'playground',
    title: 'Playground',
    icon: 'FileCode',
    layout: 'flush',
    component: AgentforcePlaygroundPanel
  });
  app.slots.experimental_createProjectAction({
    id: 'dx-project',
    title: 'Salesforce DX project',
    icon: 'Cloud',
    component: CreateSalesforceProjectDialog,
    run: (ctx) => {
      ctx.openDialog({ title: 'Create Salesforce DX project' });
    }
  });
  app.slots.pendingInteraction({
    id: 'salesforce-guardrail',
    component: SalesforceGuardrailForm
  });
  app.composer.customize({
    id: 'salesforce-banner',
    scopes: ['thread', 'new-thread'],
    banners: [{ id: 'org-status', chrome: 'card', component: SalesforceComposerBanner }]
  });
  app.slots.commandPaletteAction({
    id: 'open-playground',
    title: 'Open Agentforce Playground',
    isAvailable: (ctx) => Boolean(ctx.threadId),
    run: (ctx) => {
      openAgentforcePlayground({
        openThreadPanel: (options) => ctx.openPanel({ actionId: options.actionId, title: options.title, params: options.params }),
        projectId: ctx.projectId,
      });
    }
  });
  app.slots.commandPaletteAction({
    id: 'open-preview',
    title: 'Open Agentforce Preview',
    isAvailable: (ctx) => Boolean(ctx.threadId),
    run: (ctx) => {
      openAgentforcePreview({
        openThreadPanel: (options) => ctx.openPanel({ actionId: options.actionId, title: options.title, params: options.params })
      });
    }
  });
  app.slots.commandPaletteAction({
    id: 'open-soql',
    title: 'Open SOQL Explorer',
    isAvailable: (ctx) => Boolean(ctx.projectId),
    run: (ctx) => {
      if (!ctx.projectId) return;
      ctx.toProject(ctx.projectId, { tabId: 'soql' });
    }
  });
});

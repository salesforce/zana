import { registerSalesforcePanels } from './panels.js';
import type { ComponentType } from 'react';
import { definePluginApp, useComposerView, useZccContext, useZccNavigate, type PluginPendingInteractionProps } from '@zana-ai/zcc-plugin-sdk/app';
import { AgentforcePlaygroundPanel } from './src/app/AgentScriptPanel.js';
import { AgentforcePreviewPanel } from './src/app/AgentforcePreviewPanel.js';
import { CreateSalesforceProjectDialog } from './src/app/CreateSalesforceProjectDialog.js';
import { OrgPicker } from './src/app/OrgPicker.js';
import { SalesforceOrgsPanel } from './src/app/SalesforceOrgsPanel.js';
import { SalesforceProjectTab } from './src/app/SalesforceProjectTab.js';
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
      { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 } },
      React.createElement(
        'button',
        { type: 'button', className: 'btn primary', onClick: () => void props.submit({ approved: true }) },
        'Allow this action'
      ),
      React.createElement('button', { type: 'button', className: 'btn', onClick: () => void props.cancel() }, 'Deny')
    )
  );
}

function SalesforceComposerBanner(props: { pluginId?: string }) {
  const { scope } = useComposerView();
  const projectId = 'projectId' in scope ? scope.projectId : undefined;
  const threadId = 'threadId' in scope ? scope.threadId : undefined;
  const React = hostReact();
  if (!React) return null;
  const [status, setStatus] = React.useState<null | Record<string, unknown>>(null);
  React.useEffect(() => {
    let cancelled = false;
    setStatus(null);
    pluginHost()
      ?.callRpc(props.pluginId || 'salesforce', 'status', { projectId, threadId })
      .then((next) => {
        if (!cancelled) setStatus(next as Record<string, unknown>);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [props.pluginId, projectId, threadId]);
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
        ? 'Salesforce: pick a CLI-connected org under Plugins → Salesforce, or on the Salesforce tab. Family tools share that target.'
        : 'Salesforce: pick a CLI-connected org under Plugins → Salesforce, then run zcc sf doctor.'
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

export default definePluginApp((app) => {
  registerSalesforcePanels(app);
  app.slots.settingsSection({
    id: 'orgs',
    title: 'Connected orgs',
    description: 'Salesforce CLI orgs. Selecting one sets the shared default org.',
    component: OrgPicker
  });
  app.slots.navPanel({
    id: 'orgs',
    title: 'Salesforce',
    icon: 'Cloud',
    placement: 'unlisted',
    component: SalesforceOrgsPanel
  });
  app.slots.sidebarFooterAction({
    id: 'orgs',
    title: 'Salesforce',
    icon: 'Cloud',
    run: ({ toPluginPanel }) => {
      toPluginPanel('orgs');
    }
  });
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
    header: 'custom',
    component: SalesforceProjectTab
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
  app.slots.experimental_createProjectAction({
    id: 'dx-project',
    title: 'Salesforce project',
    icon: 'Cloud',
    component: CreateSalesforceProjectDialog,
    run: (ctx) => {
      ctx.openDialog({ title: 'Create Salesforce project' });
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
    id: 'open-orgs',
    title: 'Open Salesforce orgs',
    run: (ctx) => {
      ctx.toPluginPanel('orgs');
    }
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
});

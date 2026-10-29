import { registerSalesforcePanels } from './panels.js';
import { registerStudioDirectives } from './src/app/directives/index.js';
import { definePluginApp, useComposerView } from '@zana-ai/zcc-plugin-sdk/app';
import { AgentFileOpener } from './src/app/AgentFileOpener.js';
import { AgentThreadPanel } from './src/app/AgentThreadPanel.js';
import { AgentforcePreviewPanel } from './src/app/AgentforcePreviewPanel.js';
import { CreateSalesforceProjectDialog } from './src/app/CreateSalesforceProjectDialog.js';
import { GuardrailReview } from './src/app/GuardrailReview.js';
import { OrgPicker } from './src/app/OrgPicker.js';
import { SalesforceOrgsPanel } from './src/app/SalesforceOrgsPanel.js';
import { SalesforceProjectTab } from './src/app/SalesforceProjectTab.js';
import { SalesforceStudioDetachedCard } from './src/app/SalesforceStudioDetachedCard.js';
import { openAgentforcePreview } from './src/app/agentforce-panel-params.js';
import { AGENT_SCRIPT_TOOLS } from './src/app/AgentScriptTools.js';
import { studioPanelTool } from './src/app/studio/StudioPanelTool.js';
import { STUDIO_TAB_ID } from './src/app/studio-window-route.js';
import { isPanelTool, panelToolActionId } from './src/app/studio/studio-tool-bridge.js';

const STUDIO_TOOL_ICONS: Record<string, string> = { actions: 'Zap', comments: 'MessageSquare' };

function hostReact() {
  return (globalThis as { __ZCC_HOST_REACT__?: typeof import('react') }).__ZCC_HOST_REACT__;
}

function pluginHost() {
  return (globalThis as { __ZCC_PLUGIN_HOST__?: { callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown> } })
    .__ZCC_PLUGIN_HOST__;
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

export default definePluginApp((app) => {
  registerSalesforcePanels(app);
  registerStudioDirectives(app);
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
    title: 'Agentforce',
    extensions: ['agent', 'afscript'],
    component: AgentFileOpener
  });
  // The Studio can run in its own window; the main-window tab then shows its status.
  app.slots.projectTab({
    id: 'salesforce',
    label: 'Salesforce',
    icon: 'Cloud',
    order: 80,
    global: false,
    header: 'custom',
    statusbar: 'hidden',
    component: SalesforceProjectTab,
    detachable: true,
    detachedPlaceholder: SalesforceStudioDetachedCard
  });
  app.slots.threadPanelAction({
    id: 'agent',
    title: 'Agent',
    icon: 'Bot',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: AgentThreadPanel
  });
  app.slots.threadPanelAction({
    id: 'preview',
    title: 'Preview',
    icon: 'MessageSquare',
    layout: 'flush',
    scopes: ['thread', 'agent-session'],
    component: AgentforcePreviewPanel
  });
  // Studio tools share the page's host panel; Studio retains their agent-owned state through portals.
  for (const tool of AGENT_SCRIPT_TOOLS) {
    if (!isPanelTool(tool.id)) continue;
    app.slots.threadPanelAction({
      id: panelToolActionId(tool.id),
      title: tool.title,
      category: 'Agent Script Studio',
      icon: STUDIO_TOOL_ICONS[tool.id],
      layout: 'flush',
      scopes: ['plugin-page'],
      pages: ['salesforce'],
      component: studioPanelTool(tool.id, tool.title)
    });
  }
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
    component: GuardrailReview
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
    title: 'Open Agentforce Studio',
    isAvailable: (ctx) => Boolean(ctx.projectId),
    run: (ctx) => {
      if (ctx.projectId) ctx.toProject(ctx.projectId, { tabId: STUDIO_TAB_ID });
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

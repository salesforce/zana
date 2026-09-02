import type { ComponentType, ReactNode } from 'react';
import { definePluginApp, useZccNavigate, type PluginPendingInteractionProps } from '@zana-ai/zcc-plugin-sdk/app';
import { AgentScriptPanel } from './src/app/AgentScriptPanel.js';

function hostReact() {
  return (globalThis as { __ZCC_HOST_REACT__?: typeof import('react') }).__ZCC_HOST_REACT__;
}

function pluginHost() {
  return (globalThis as { __ZCC_PLUGIN_HOST__?: { callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown> } })
    .__ZCC_PLUGIN_HOST__;
}

function pad(children: ReactNode) {
  const React = hostReact();
  if (!React) return null;
  return React.createElement('div', { style: { padding: 16, height: '100%', boxSizing: 'border-box' } }, children);
}

function SalesforceProjectTab(props: { pluginId: string; projectId: string }) {
  const React = hostReact();
  const navigate = useZccNavigate();
  if (!React) return null;
  const [status, setStatus] = React.useState<null | Record<string, unknown>>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    pluginHost()
      ?.callRpc(props.pluginId, 'status')
      .then((next) => {
        if (!cancelled) setStatus(next as Record<string, unknown>);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [props.pluginId]);
  const last = status?.lastDoctor as { org?: { alias: string; kind: string }; cliOk?: boolean; cliError?: string; agentBundleCount?: number } | undefined;
  const orgLabel = last?.org
    ? `${last.org.alias} (${last.org.kind})`
    : (status?.defaultOrg as string) || 'No org configured';
  return pad(
    React.createElement(
      React.Fragment,
      null,
      React.createElement('h2', { style: { marginTop: 0 } }, 'Salesforce'),
      React.createElement('p', null, orgLabel),
      last?.cliOk === false
        ? React.createElement('p', { style: { color: 'var(--danger)' } }, last.cliError || 'Salesforce CLI missing')
        : null,
      last && typeof last.agentBundleCount === 'number'
        ? React.createElement(
            'p',
            { style: { color: 'var(--text-muted)' } },
            `${last.agentBundleCount} .agent bundle${last.agentBundleCount === 1 ? '' : 's'}`
          )
        : null,
      status && !status.dxProject
        ? React.createElement(
            'p',
            { style: { color: 'var(--text-muted)' } },
            'No sfdx-project.json at the configured DX project root.'
          )
        : null,
      error ? React.createElement('p', { style: { color: 'var(--danger)' } }, error) : null,
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8 } },
        React.createElement(
          'button',
          {
            type: 'button',
            disabled: busy,
            onClick: () => {
              setBusy(true);
              setError(null);
              pluginHost()
                ?.callRpc(props.pluginId, 'doctor')
                .then((report) => {
                  setStatus((current) => ({ ...(current ?? {}), lastDoctor: report }));
                })
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }
          },
          busy ? 'Running doctor…' : 'Run doctor'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => navigate.toPluginPanel('agent-script')
          },
          'Open Agent Script'
        )
      )
    )
  );
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
  if (!status.defaultOrg && status.dxProject) {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      'Salesforce: set a default org alias under Plugins → Salesforce, then run zcc sf doctor.'
    );
  }
  if (kind === 'production') {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      `Salesforce: target org ${status.defaultOrg} is production. Org reads, anonymous Apex, and Agent publish/activate require confirmation.`
    );
  }
  if (kind === 'unknown') {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      `Salesforce: target org ${status.defaultOrg} kind is unknown. Access and Agent publish/activate require confirmation.`
    );
  }
  if ((last?.agentBundleCount ?? 0) > 0) {
    return React.createElement(
      'p',
      { style: { margin: 0 } },
      'Salesforce: Agent publish/activate requires confirmation.'
    );
  }
  return null;
}

function AgentFileOpener(props: { pluginId: string; path: string; experimental_Original: ComponentType }) {
  const React = hostReact();
  const navigate = useZccNavigate();
  if (!React) return null;
  const Original = props.experimental_Original;
  return React.createElement(
    'div',
    { className: 'salesforce-agent-opener', style: { display: 'grid', gap: 8, padding: 8 } },
    React.createElement('p', { style: { margin: 0, color: 'var(--text-muted)' } }, props.path),
    React.createElement(
      'button',
      {
        type: 'button',
        onClick: () => navigate.toPluginPanel('agent-script', { subPath: props.path })
      },
      'Open in Agent Script'
    ),
    React.createElement(Original)
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'agent-script',
    title: 'Agent Script',
    icon: 'FileCode',
    component: AgentScriptPanel
  });
  app.slots.fileOpener({
    id: 'agent',
    title: 'Agent Script',
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
    id: 'open-agent-script',
    title: 'Open Agent Script',
    run: (ctx) => {
      ctx.toPluginPanel('agent-script');
    }
  });
});

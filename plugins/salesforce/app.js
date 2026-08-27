function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function pluginHost() {
  return globalThis.__ZCC_PLUGIN_HOST__;
}

function pad(children) {
  const React = hostReact();
  if (!React) return null;
  return React.createElement(
    'div',
    { style: { padding: 16, height: '100%', boxSizing: 'border-box' } },
    children
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'salesforce',
      title: 'Salesforce',
      description: 'DX org alias, API version, and local project root. Family tools stay fail-closed without an org.',
      component: function SalesforceSettings() {
        const React = hostReact();
        if (!React) return null;
        return pad(
          React.createElement(
            'p',
            { style: { color: 'var(--text-muted)', marginTop: 0 } },
            'Set Default org alias and DX project root on this plugin’s detail page, then run zcc sf doctor. GUS/Tickets stay a separate marketplace extension.'
          )
        );
      }
    });

    app.slots.projectTab({
      id: 'salesforce',
      label: 'Salesforce',
      icon: 'Cloud',
      order: 80,
      global: false,
      component: function SalesforceProjectTab(props) {
        const React = hostReact();
        if (!React) return null;
        const [status, setStatus] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState(null);
        React.useEffect(() => {
          let cancelled = false;
          pluginHost()
            ?.callRpc(props.pluginId, 'status')
            .then((next) => {
              if (!cancelled) setStatus(next);
            })
            .catch((err) => {
              if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            });
          return () => {
            cancelled = true;
          };
        }, [props.pluginId]);
        const last = status?.lastDoctor;
        const orgLabel = last?.org
          ? `${last.org.alias} (${last.org.kind})`
          : status?.defaultOrg || 'No org configured';
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
              ? React.createElement('p', { style: { color: 'var(--text-muted)' } }, 'No sfdx-project.json at the configured DX project root.')
              : null,
            error ? React.createElement('p', { style: { color: 'var(--danger)' } }, error) : null,
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
            )
          )
        );
      }
    });

    app.slots.pendingInteraction({
      id: 'salesforce-guardrail',
      component: function SalesforceGuardrailForm(props) {
        const React = hostReact();
        if (!React) return null;
        const payload = props.interaction.payload && typeof props.interaction.payload === 'object'
          ? props.interaction.payload
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
              { type: 'button', onClick: () => props.submit({ approved: true }) },
              'Allow this action'
            ),
            React.createElement(
              'button',
              { type: 'button', onClick: () => props.cancel() },
              'Deny'
            )
          )
        );
      }
    });

    app.composer.customize({
      id: 'salesforce-banner',
      scopes: ['thread', 'new-thread'],
      banners: [
        {
          id: 'org-status',
          chrome: 'card',
          component: function SalesforceComposerBanner(props) {
            const React = hostReact();
            if (!React) return null;
            const [status, setStatus] = React.useState(null);
            React.useEffect(() => {
              let cancelled = false;
              pluginHost()
                ?.callRpc(props.pluginId || 'salesforce', 'status')
                .then((next) => {
                  if (!cancelled) setStatus(next);
                })
                .catch(() => undefined);
              return () => {
                cancelled = true;
              };
            }, [props.pluginId]);
            if (!status) return null;
            const kind = status.lastDoctor?.org?.kind;
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
            if ((status.lastDoctor?.agentBundleCount ?? 0) > 0) {
              return React.createElement(
                'p',
                { style: { margin: 0 } },
                'Salesforce: Agent publish/activate requires confirmation.'
              );
            }
            return null;
          }
        }
      ]
    });
  }
};

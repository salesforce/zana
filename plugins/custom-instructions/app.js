export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'custom-instructions',
      title: 'Custom instructions',
      description: 'Standing text included in later agent threads on this host.',
      component: function CustomInstructionsSection(props) {
        const React = globalThis.__ZCC_HOST_REACT__;
        if (!React) return null;
        const { useEffect, useState } = React;
        const [value, setValue] = useState('');
        useEffect(() => {
          globalThis.__ZCC_PLUGIN_HOST__
            ?.getSettings(props.pluginId)
            .then((snapshot) => {
              const next = snapshot?.values?.instructions;
              setValue(typeof next === 'string' ? next : '');
            })
            .catch(() => {});
        }, [props.pluginId]);
        return React.createElement(
          'section',
          { style: { marginTop: 24 } },
          React.createElement('h2', { style: { marginTop: 0 } }, 'Custom instructions'),
          React.createElement(
            'p',
            { style: { color: 'var(--text-muted)', fontSize: 13 } },
            'Saved on this host and contributed to later threads. Blank text contributes nothing.'
          ),
          React.createElement('textarea', {
            value,
            rows: 8,
            style: { width: '100%', marginTop: 8 },
            onChange: (event) => setValue(event.target.value),
            onBlur: () => {
              globalThis.__ZCC_PLUGIN_HOST__
                ?.setSettings(props.pluginId, { instructions: value })
                .catch(() => {});
            }
          })
        );
      }
    });
  }
};

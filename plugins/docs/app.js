function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.threadPanelAction({
      id: 'library',
      title: 'Library',
      layout: 'padded',
      component: function DocsThreadPanel() {
        const React = hostReact();
        if (!React) return null;
        return React.createElement(
          'div',
          { style: { padding: 24 } },
          React.createElement('h2', { style: { marginTop: 0 } }, 'Library'),
          React.createElement(
            'p',
            { style: { color: 'var(--text-muted)' } },
            'Open the Docs rail or the project Library tab for the full catalogue.'
          )
        );
      }
    });
    app.slots.experimental_newThreadPanelAction({
      id: 'library',
      title: 'Library',
      component: function DocsComposePanel(props) {
        const React = hostReact();
        if (!React) return null;
        return React.createElement(
          'p',
          { style: { padding: 16 } },
          'Library for ',
          props.projectId || 'this workspace'
        );
      }
    });
    app.slots.fileOpener({
      id: 'md',
      title: 'Docs',
      extensions: ['md', 'mdx'],
      component: function DocsOpener(props) {
        const Original = props.experimental_Original;
        const React = hostReact();
        if (!React) return null;
        return React.createElement(
          'div',
          { className: 'docs-file-opener' },
          React.createElement('p', { className: 'docs-file-opener-path' }, props.path),
          React.createElement(Original)
        );
      }
    });
    app.slots.messageDirective({
      id: 'doc',
      component: function DocDirective(props) {
        const React = hostReact();
        if (!React) return null;
        return React.createElement(
          'a',
          { className: 'plugin-directive', href: '#' },
          props.attributes.title || props.attributes.path || 'Doc'
        );
      }
    });
  }
};

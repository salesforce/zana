function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

export default {
  __zccPluginApp: true,
  setup(app) {
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

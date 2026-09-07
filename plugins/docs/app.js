import { parseDocDirectiveAttributes } from './src/doc-directive.js';

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function DocsOpener(props) {
  const Original = props.experimental_Original;
  const React = hostReact();
  if (!React) return null;
  return React.createElement(
    'div',
    { className: 'docs-file-opener' },
    React.createElement(Original)
  );
}

function DocDirective(props) {
  const React = hostReact();
  if (!React) return null;
  const document = parseDocDirectiveAttributes(props.attributes);
  if (!document) {
    return React.createElement(
      'div',
      { className: 'plugin-directive-card plugin-directive-card--error', role: 'alert', title: props.source },
      'Invalid Docs link. Expected a Markdown or HTML path.'
    );
  }
  const openPreview = () => {
    if (typeof props.openWorkspaceFile === 'function') {
      props.openWorkspaceFile(document.path);
    }
  };
  return React.createElement(
    'div',
    { className: 'plugin-directive-card' },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'plugin-directive-card-main',
        onClick: openPreview,
        disabled: typeof props.openWorkspaceFile !== 'function',
        title: document.path
      },
      React.createElement('span', { className: 'plugin-directive-card-kind' }, 'Docs'),
      React.createElement('span', { className: 'plugin-directive-card-title' }, document.title),
      document.vault
        ? React.createElement('span', { className: 'plugin-directive-card-meta' }, document.vault)
        : null
    )
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.fileOpener({
      id: 'md',
      title: 'Docs',
      extensions: ['md', 'mdx'],
      component: DocsOpener
    });
    app.slots.messageDirective({
      id: 'doc',
      component: DocDirective
    });
  }
};

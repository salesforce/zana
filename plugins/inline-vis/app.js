import {
  DEFAULT_HEIGHT_PX,
  MAX_HTML_CHARS,
  parsePreviewHeight,
  parsePreviewSource,
  previewContentUrl,
  previewKindForFile,
  renderSafeMarkdown,
  requirePreviewFile
} from './src/preview.js';

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function InlineVisDirective(props) {
  const React = hostReact();
  if (!React) return null;
  const { useEffect, useState } = React;
  const file = requirePreviewFile(props.attributes?.file);
  const source = parsePreviewSource(props.attributes?.source);
  const height = parsePreviewHeight(props.attributes?.height);
  const [state, setState] = useState(
    height === null
      ? { status: 'invalid-height' }
      : source === null
        ? { status: 'invalid-source' }
        : file
          ? { status: 'loading', file, source }
          : { status: 'missing-file' }
  );

  useEffect(() => {
    if (height === null) {
      setState({ status: 'invalid-height' });
      return undefined;
    }
    if (source === null) {
      setState({ status: 'invalid-source' });
      return undefined;
    }
    if (!file) {
      setState({ status: 'missing-file' });
      return undefined;
    }
    const threadId = props.message?.threadId;
    if (!threadId) {
      setState({ status: 'error', file, message: 'No thread is attached to this message.' });
      return undefined;
    }
    const kind = previewKindForFile(file);
    let cancelled = false;
    setState({ status: 'loading', file, source });
    void fetch(previewContentUrl(threadId, file, source), { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'File not found' : `HTTP ${response.status}`);
        }
        const body = await response.json();
        if (body?.encoding && body.encoding !== 'utf8') {
          throw new Error('Visualization must be a UTF-8 file');
        }
        const content = typeof body?.content === 'string' ? body.content : '';
        if (!content.trim()) throw new Error('File is empty');
        if (content.length > MAX_HTML_CHARS) throw new Error('File is larger than 5 MiB');
        if (cancelled) return;
        if (kind === 'markdown') {
          setState({ status: 'ready', kind: 'markdown', file, source, content });
          return;
        }
        setState({ status: 'ready', kind: 'html', file, source, html: content });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          file,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    return () => {
      cancelled = true;
    };
  }, [file, height, source, props.message?.threadId]);

  if (state.status === 'missing-file') {
    return React.createElement(
      'div',
      { className: 'plugin-directive-card plugin-directive-card--error', role: 'alert', title: props.source },
      'inline-vis requires a workspace HTML or Markdown file, e.g. ::vis{file="charts/out.html"}'
    );
  }
  if (state.status === 'invalid-height') {
    return React.createElement(
      'div',
      { className: 'plugin-directive-card plugin-directive-card--error', role: 'alert', title: props.source },
      'inline-vis height must be a whole number from 120 to 1200 pixels.'
    );
  }
  if (state.status === 'invalid-source') {
    return React.createElement(
      'div',
      { className: 'plugin-directive-card plugin-directive-card--error', role: 'alert', title: props.source },
      'inline-vis source must be workspace or thread-storage.'
    );
  }

  const openAction = state.source === 'workspace' && typeof props.openWorkspaceFile === 'function'
    ? React.createElement(
      'button',
      {
        type: 'button',
        className: 'plugin-directive-card-open',
        onClick: () => props.openWorkspaceFile(state.file),
        'aria-label': `Open ${state.file} in side panel`,
        title: 'Open in side panel'
      },
      'Open'
    )
    : null;

  if (state.status === 'loading') {
    return React.createElement(
      'div',
      { className: 'plugin-directive-vis', role: 'status', 'aria-busy': 'true' },
      React.createElement(
        'div',
        { className: 'plugin-directive-vis-chrome' },
        React.createElement('span', { className: 'plugin-directive-card-kind' }, 'vis'),
        React.createElement('span', { className: 'plugin-directive-card-title' }, state.file),
        openAction
      ),
      React.createElement('div', {
        className: 'plugin-directive-vis-frame plugin-directive-vis-frame--loading',
        style: { height: `${height ?? DEFAULT_HEIGHT_PX}px` }
      })
    );
  }
  if (state.status === 'error') {
    return React.createElement(
      'div',
      { className: 'plugin-directive-card plugin-directive-card--error', role: 'alert', title: props.source },
      `Failed to load ${state.file}: ${state.message}`
    );
  }
  const body = state.kind === 'markdown'
    ? React.createElement(
      'div',
      {
        className: 'plugin-directive-vis-markdown-wrap',
        style: { height: `${height ?? DEFAULT_HEIGHT_PX}px`, overflow: 'auto' }
      },
      renderSafeMarkdown(React, state.content)
    )
    : React.createElement('iframe', {
      className: 'plugin-directive-vis-frame',
      title: `inline-vis: ${state.file}`,
      sandbox: 'allow-scripts',
      srcDoc: state.html,
      style: { height: `${height ?? DEFAULT_HEIGHT_PX}px` }
    });
  return React.createElement(
    'div',
    { className: 'plugin-directive-vis' },
    React.createElement(
      'div',
      { className: 'plugin-directive-vis-chrome' },
      React.createElement('span', { className: 'plugin-directive-card-kind' }, 'vis'),
      React.createElement('span', { className: 'plugin-directive-card-title' }, state.file),
      openAction
    ),
    body
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.messageDirective({
      id: 'vis',
      component: InlineVisDirective
    });
  }
};

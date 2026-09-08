import { pdfBlobFromFileResponse, resolvePdfReadTarget } from './pdf-source.js';

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function PdfFileOpener(props) {
  const React = hostReact();
  if (!React) return null;
  const Original = props.experimental_Original;
  const { useEffect, useMemo, useState } = React;
  const target = useMemo(
    () => resolvePdfReadTarget(props.path, props.source),
    [props.path, props.source]
  );
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (!target) return undefined;
    const controller = new AbortController();
    let objectUrl = null;
    setState({ status: 'loading' });
    void fetch(target, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`PDF request failed with status ${response.status}.`);
        }
        return pdfBlobFromFileResponse(await response.json());
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: 'ready', frameLoaded: false, url: objectUrl });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: errorMessage(error) });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reloadNonce, target]);

  if (!target) return React.createElement(Original);
  if (state.status === 'error') {
    return React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          height: '100%',
          minHeight: 0,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }
      },
      React.createElement(
        'div',
        { role: 'alert', style: { maxWidth: 420, textAlign: 'center' } },
        React.createElement(
          'p',
          { style: { color: 'var(--danger, #c44)', marginTop: 0 } },
          `Failed to load PDF: ${state.message}`
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setReloadNonce((current) => current + 1)
          },
          'Retry'
        )
      )
    );
  }
  if (state.status === 'loading' || !state.url) {
    return React.createElement(
      'div',
      {
        role: 'status',
        'aria-label': `Loading ${props.path}`,
        style: {
          display: 'flex',
          height: '100%',
          minHeight: 0,
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)'
        }
      },
      'Loading PDF…'
    );
  }
  return React.createElement(
    'div',
    { style: { position: 'relative', height: '100%', minHeight: 0, overflow: 'hidden' } },
    state.frameLoaded
      ? null
      : React.createElement(
          'div',
          {
            role: 'status',
            'aria-label': `Rendering ${props.path}`,
            style: {
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              background: 'var(--bg, inherit)'
            }
          },
          'Rendering PDF…'
        ),
    React.createElement('iframe', {
      src: state.url,
      title: props.path,
      style: { display: 'block', width: '100%', height: '100%', border: 0 },
      onLoad: () => {
        setState((current) =>
          current.status === 'ready' ? { ...current, frameLoaded: true } : current
        );
      }
    })
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.fileOpener({
      id: 'pdf',
      title: 'PDF viewer',
      extensions: ['pdf'],
      component: PdfFileOpener
    });
  }
};

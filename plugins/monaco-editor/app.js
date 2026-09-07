import { CLAIMED_EXTENSIONS, languageForPath } from './languages.js';

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function hostRpc() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__?.useRpc?.() ?? null;
}

function hostMonaco() {
  return globalThis.__ZCC_MONACO__ ?? null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function MonacoFileOpener(props) {
  const React = hostReact();
  const rpc = hostRpc();
  if (!React) return null;
  const Original = props.experimental_Original;
  const { useCallback, useEffect, useRef, useState } = React;
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const sha256Ref = useRef(null);
  const saveStateRef = useRef({ kind: 'clean' });
  const [status, setStatus] = useState({ kind: 'loading' });
  const [saveState, setSaveStateValue] = useState({ kind: 'clean' });
  const setSaveState = useCallback((next) => {
    saveStateRef.current = next;
    setSaveStateValue(next);
  }, []);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !rpc || saveStateRef.current.kind === 'saving') return;
    setSaveState({ kind: 'saving' });
    try {
      const result = await rpc.call('write', {
        path: props.path,
        source: props.source,
        content: editor.getValue(),
        expectedSha256: sha256Ref.current
      });
      if (result?.outcome === 'conflict') {
        setSaveState({ kind: 'conflict' });
        return;
      }
      sha256Ref.current = result?.sha256 ?? null;
      setSaveState({ kind: 'clean' });
    } catch (error) {
      setSaveState({ kind: 'error', message: errorMessage(error) });
    }
  }, [props.path, props.source, rpc, setSaveState]);

  useEffect(() => {
    if (!rpc) {
      setStatus({ kind: 'delegate', reason: 'Editor RPC is not available' });
      return undefined;
    }
    let disposed = false;
    let editor = null;
    let disposable = null;
    setStatus({ kind: 'loading' });
    void rpc
      .call('read', { path: props.path, source: props.source })
      .then(async (file) => {
        if (disposed) return;
        if (file?.kind !== 'text') {
          setStatus({
            kind: 'delegate',
            reason: typeof file?.reason === 'string' ? file.reason : 'This file cannot be edited here'
          });
          return;
        }
        const monaco = hostMonaco();
        const container = containerRef.current;
        if (!monaco || !container) {
          setStatus({ kind: 'delegate', reason: 'Monaco is not loaded in this window' });
          return;
        }
        sha256Ref.current = file.sha256;
        editor = monaco.editor.create(container, {
          value: file.content,
          language: languageForPath(props.path),
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 12,
          scrollBeyondLastLine: false,
          wordWrap: 'on'
        });
        editorRef.current = editor;
        disposable = editor.onDidChangeModelContent(() => {
          if (saveStateRef.current.kind !== 'dirty') setSaveState({ kind: 'dirty' });
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          void save();
        });
        setStatus({ kind: 'ready' });
        setSaveState({ kind: 'clean' });
      })
      .catch((error) => {
        if (!disposed) setStatus({ kind: 'error', message: errorMessage(error) });
      });
    return () => {
      disposed = true;
      disposable?.dispose?.();
      editor?.dispose?.();
      editorRef.current = null;
    };
  }, [props.path, props.source, rpc, save]);

  if (status.kind === 'delegate') {
    return React.createElement(Original);
  }
  if (status.kind === 'error') {
    return React.createElement(
      'p',
      { role: 'alert', style: { color: 'var(--danger, #c44)', padding: 16 } },
      status.message
    );
  }

  const saveLabel =
    saveState.kind === 'saving'
      ? 'Saving…'
      : saveState.kind === 'conflict'
        ? 'Disk changed — save anyway'
        : saveState.kind === 'error'
          ? 'Retry save'
          : saveState.kind === 'dirty'
            ? 'Save'
            : 'Saved';

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0
      }
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--border, #333)'
        }
      },
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: saveState.kind === 'saving' || saveState.kind === 'clean',
          onClick: () => {
            if (saveState.kind === 'conflict') sha256Ref.current = null;
            void save();
          }
        },
        saveLabel
      ),
      saveState.kind === 'error'
        ? React.createElement(
            'span',
            { role: 'alert', style: { color: 'var(--danger, #c44)', fontSize: 12 } },
            saveState.message
          )
        : null
    ),
    status.kind === 'loading'
      ? React.createElement(
          'div',
          {
            role: 'status',
            style: { padding: 16, color: 'var(--text-muted)' }
          },
          'Loading editor…'
        )
      : null,
    React.createElement('div', {
      ref: containerRef,
      style: { flex: 1, minHeight: 0, display: status.kind === 'ready' ? 'block' : 'none' }
    })
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.fileOpener({
      id: 'code',
      title: 'File Editor',
      extensions: CLAIMED_EXTENSIONS,
      component: MonacoFileOpener
    });
  }
};

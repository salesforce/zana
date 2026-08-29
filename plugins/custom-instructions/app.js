/** Builtin custom-instructions Settings section. Served unbundled — use host globals. */

const AUTOSAVE_DELAY_MS = 500;

function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function hostRpc() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__?.useRpc?.() ?? null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function CustomInstructionsSettings({ rpc }) {
  const React = hostReact();
  if (!React || !rpc) return null;
  const { useEffect, useRef, useState } = React;
  const saveQueue = useRef(Promise.resolve());
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');
  const [maxLength, setMaxLength] = useState(4096);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle');
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call('getInstructions')
      .then((response) => {
        if (!active) return;
        const instructions =
          typeof response?.instructions === 'string' ? response.instructions : '';
        const nextMax =
          typeof response?.maxLength === 'number' && response.maxLength > 0
            ? response.maxLength
            : 4096;
        setDraft(instructions);
        setSaved(instructions);
        setMaxLength(nextMax);
        setSaveState('saved');
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  useEffect(() => {
    if (isLoading || draft === saved) return;
    let active = true;
    const instructions = draft;
    const timeout = globalThis.setTimeout(() => {
      setSaveState('saving');
      const save = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          const response = await rpc.call('saveInstructions', { instructions });
          if (!active) return;
          const next =
            typeof response?.instructions === 'string' ? response.instructions : instructions;
          const nextMax =
            typeof response?.maxLength === 'number' && response.maxLength > 0
              ? response.maxLength
              : 4096;
          setSaved(next);
          setMaxLength(nextMax);
          setSaveState('saved');
        })
        .catch((saveError) => {
          if (!active) return;
          setError(errorMessage(saveError));
          setSaveState('error');
        });
      saveQueue.current = save;
    }, AUTOSAVE_DELAY_MS);
    return () => {
      active = false;
      globalThis.clearTimeout(timeout);
    };
  }, [draft, isLoading, rpc, saved]);

  return React.createElement(
    'div',
    null,
    React.createElement('textarea', {
      'aria-label': 'Custom instructions',
      className: 'settings-textarea',
      value: draft,
      maxLength,
      disabled: isLoading,
      rows: 8,
      placeholder: 'Add your custom instructions…',
      onChange: (event) => {
        setDraft(event.target.value);
        setError(null);
        setSaveState('pending');
      }
    }),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          minHeight: 32,
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginTop: 4
        }
      },
      React.createElement(
        'span',
        { style: { color: 'var(--text-muted)', fontSize: 12 } },
        `${draft.length.toLocaleString()} / ${maxLength.toLocaleString()}`
      ),
      error !== null
        ? React.createElement(
            'span',
            { style: { color: 'var(--danger, #c44)', fontSize: 12 }, role: 'alert' },
            error
          )
        : React.createElement(
            'span',
            { style: { color: 'var(--text-muted)', fontSize: 12 }, role: 'status' },
            isLoading
              ? 'Loading…'
              : saveState === 'pending' || saveState === 'saving'
                ? 'Saving…'
                : 'Saved'
          )
    )
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: 'custom-instructions',
    description: 'Give agents extra instructions and context for later threads on this host.',
    component: function CustomInstructionsSection() {
      const React = hostReact();
      const rpc = hostRpc();
      if (!React) return null;
      return React.createElement(CustomInstructionsSettings, { rpc });
    }
  });
});

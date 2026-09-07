function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function hostRpc() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__?.useRpc?.() ?? null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function MemorySettings() {
  const React = hostReact();
  const rpc = hostRpc();
  if (!React || !rpc) return null;
  const { useEffect, useState } = React;
  const [memories, setMemories] = useState([]);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);

  const reload = () => {
    void rpc
      .call('listMemories')
      .then((response) => {
        setMemories(Array.isArray(response?.memories) ? response.memories : []);
        setError(null);
      })
      .catch((loadError) => setError(errorMessage(loadError)));
  };

  useEffect(() => {
    reload();
  }, []);

  return React.createElement(
    'div',
    null,
    React.createElement(
      'p',
      { style: { color: 'var(--text-muted)', fontSize: 13 } },
      'Durable memories injected as a compact catalog on each agent turn. Agents maintain them with `zcc memory`.'
    ),
    error ? React.createElement('p', { role: 'alert', style: { color: 'var(--danger, #c44)' } }, error) : null,
    memories.length === 0
      ? React.createElement('p', { style: { color: 'var(--text-muted)' } }, 'No memories stored yet.')
      : React.createElement(
          'table',
          { style: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } },
          React.createElement(
            'thead',
            null,
            React.createElement(
              'tr',
              null,
              ['Name', 'Scope', 'Kind', 'Summary', ''].map((label) =>
                React.createElement(
                  'th',
                  { key: label, style: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border, #333)' } },
                  label
                )
              )
            )
          ),
          React.createElement(
            'tbody',
            null,
            memories.map((memory) =>
              React.createElement(
                'tr',
                { key: memory.id },
                React.createElement('td', { style: { padding: '6px 8px' } }, memory.name),
                React.createElement('td', { style: { padding: '6px 8px' } }, memory.scope),
                React.createElement('td', { style: { padding: '6px 8px' } }, memory.kind),
                React.createElement('td', { style: { padding: '6px 8px' } }, memory.summary),
                React.createElement(
                  'td',
                  { style: { padding: '6px 8px' } },
                  React.createElement(
                    'button',
                    { type: 'button', onClick: () => setEditing(memory) },
                    'Edit'
                  ),
                  ' ',
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        void rpc
                          .call('deleteMemory', { id: memory.id, expectedVersion: memory.version })
                          .then(reload)
                          .catch((deleteError) => setError(errorMessage(deleteError)));
                      }
                    },
                    'Delete'
                  )
                )
              )
            )
          )
        ),
    editing
      ? React.createElement(
          'div',
          { style: { marginTop: 16, display: 'grid', gap: 8 } },
          React.createElement('textarea', {
            'aria-label': 'Memory summary',
            className: 'settings-textarea',
            rows: 2,
            value: editing.summary,
            onChange: (event) => setEditing({ ...editing, summary: event.target.value })
          }),
          React.createElement('textarea', {
            'aria-label': 'Memory details',
            className: 'settings-textarea',
            rows: 6,
            value: editing.details,
            onChange: (event) => setEditing({ ...editing, details: event.target.value })
          }),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 8 } },
            React.createElement(
              'button',
              { type: 'button', onClick: () => setEditing(null) },
              'Cancel'
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => {
                  void rpc
                    .call('updateMemory', {
                      id: editing.id,
                      expectedVersion: editing.version,
                      summary: editing.summary,
                      details: editing.details,
                      kind: editing.kind,
                      tags: editing.tags,
                      importance: editing.importance,
                      pinned: editing.pinned
                    })
                    .then(() => {
                      setEditing(null);
                      reload();
                    })
                    .catch((saveError) => setError(errorMessage(saveError)));
                }
              },
              'Save'
            )
          )
        )
      : null
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'memory',
      description: 'Review, edit, and delete durable memories injected into agents.',
      component: MemorySettings
    });
  }
};

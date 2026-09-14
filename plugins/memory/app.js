const MEMORY_KINDS = ['fact', 'preference', 'decision', 'procedure', 'episode', 'reference'];

function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function hostRpc() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__?.useRpc?.() ?? null;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isMemoryKind(value) {
  return MEMORY_KINDS.includes(value);
}

function MemoryEditor({ memory, onCancel, onSaved, rpc, React }) {
  const { useState } = React;
  const [draft, setDraft] = useState(memory);
  const [tags, setTags] = useState(Array.isArray(memory.tags) ? memory.tags.join(', ') : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  return React.createElement(
    'div',
    { style: { marginTop: 8, display: 'grid', gap: 8 } },
    React.createElement('textarea', {
      'aria-label': 'Memory summary',
      className: 'settings-textarea',
      rows: 2,
      maxLength: 400,
      value: draft.summary,
      onChange: (event) => setDraft({ ...draft, summary: event.target.value })
    }),
    React.createElement('input', {
      'aria-label': 'Memory tags',
      className: 'settings-input',
      placeholder: 'comma, separated',
      value: tags,
      onChange: (event) => setTags(event.target.value)
    }),
    React.createElement('textarea', {
      'aria-label': 'Memory details',
      className: 'settings-textarea',
      rows: 6,
      maxLength: 16_000,
      value: draft.details,
      onChange: (event) => setDraft({ ...draft, details: event.target.value })
    }),
    React.createElement(
      'div',
      { style: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
      React.createElement(
        'label',
        { style: { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' } },
        'Kind',
        React.createElement(
          'select',
          {
            'aria-label': 'Memory kind',
            value: draft.kind,
            onChange: (event) => {
              if (isMemoryKind(event.target.value)) {
                setDraft({ ...draft, kind: event.target.value });
              }
            }
          },
          MEMORY_KINDS.map((kind) => React.createElement('option', { key: kind, value: kind }, kind))
        )
      ),
      React.createElement(
        'label',
        { style: { display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' } },
        'Importance',
        React.createElement('input', {
          'aria-label': 'Memory importance',
          type: 'number',
          min: 0,
          max: 100,
          value: draft.importance,
          onChange: (event) => setDraft({ ...draft, importance: Number(event.target.value) })
        })
      ),
      React.createElement(
        'label',
        { style: { display: 'flex', alignItems: 'end', gap: 8, fontSize: 13, paddingBottom: 4 } },
        React.createElement('input', {
          'aria-label': 'Pinned memory',
          type: 'checkbox',
          checked: Boolean(draft.pinned),
          onChange: (event) => setDraft({ ...draft, pinned: event.target.checked })
        }),
        'Pinned'
      )
    ),
    error ? React.createElement('p', { role: 'alert', style: { color: 'var(--danger, #c44)', fontSize: 12 } }, error) : null,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
      React.createElement(
        'button',
        { type: 'button', disabled: saving, onClick: onCancel },
        'Cancel'
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: saving,
          onClick: () => {
            setSaving(true);
            setError(null);
            void rpc
              .call('updateMemory', {
                id: draft.id,
                expectedVersion: draft.version,
                summary: draft.summary,
                details: draft.details,
                kind: draft.kind,
                tags: tags
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                importance: draft.importance,
                pinned: draft.pinned
              })
              .then((result) => onSaved(result?.memory ?? draft))
              .catch((saveError) => setError(errorMessage(saveError)))
              .finally(() => setSaving(false));
          }
        },
        saving ? 'Saving…' : 'Save'
      )
    )
  );
}

function MemorySettings() {
  const React = hostReact();
  const rpc = hostRpc();
  if (!React || !rpc) return null;
  const { useEffect, useState } = React;
  const [memories, setMemories] = useState([]);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const reload = () => {
    setLoading(true);
    void rpc
      .call('listMemories')
      .then((response) => {
        setMemories(Array.isArray(response?.memories) ? response.memories : []);
        setError(null);
      })
      .catch((loadError) => setError(errorMessage(loadError)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
  }, []);

  if (loading && memories.length === 0 && !error) {
    return React.createElement('p', { style: { color: 'var(--text-muted)', fontSize: 13 } }, 'Loading memories…');
  }

  return React.createElement(
    'div',
    { style: { display: 'grid', gap: 12 } },
    React.createElement(
      'p',
      { style: { color: 'var(--text-muted)', fontSize: 13 } },
      'This plugin shares memory across providers. Disable provider-native memory under Settings → Providers to avoid duplicate or conflicting stores. Agents maintain memories with `zcc memory`.'
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
              ['Memory', 'Scope', ''].map((label) =>
                React.createElement(
                  'th',
                  {
                    key: label,
                    style: { textAlign: label === '' ? 'right' : 'left', padding: '6px 8px', borderBottom: '1px solid var(--border, #333)' }
                  },
                  label
                )
              )
            )
          ),
          React.createElement(
            'tbody',
            null,
            memories.flatMap((memory) => {
              const row = React.createElement(
                'tr',
                { key: memory.id },
                React.createElement(
                  'td',
                  { style: { padding: '6px 8px', verticalAlign: 'top' } },
                  React.createElement('div', { style: { fontWeight: 600 } }, `${memory.pinned ? '📌 ' : ''}${memory.name}`),
                  React.createElement('div', { style: { color: 'var(--text-muted)', marginTop: 4 } }, memory.summary),
                  React.createElement(
                    'div',
                    { style: { color: 'var(--text-muted)', fontSize: 12, marginTop: 6 } },
                    `${memory.kind} · importance ${memory.importance}`
                  )
                ),
                React.createElement(
                  'td',
                  { style: { padding: '6px 8px', verticalAlign: 'top', color: 'var(--text-muted)' } },
                  React.createElement('div', null, memory.scope),
                  memory.projectId
                    ? React.createElement(
                        'div',
                        { style: { fontSize: 12, marginTop: 4 }, title: memory.projectId },
                        memory.projectId
                      )
                    : null
                ),
                React.createElement(
                  'td',
                  { style: { padding: '6px 8px', verticalAlign: 'top', textAlign: 'right' } },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setEditingId((current) => (current === memory.id ? null : memory.id))
                    },
                    'Edit'
                  ),
                  ' ',
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      disabled: deletingId === memory.id,
                      onClick: () => {
                        if (!globalThis.confirm?.(`Delete memory “${memory.name}”?`)) return;
                        setDeletingId(memory.id);
                        setError(null);
                        void rpc
                          .call('deleteMemory', { id: memory.id, expectedVersion: memory.version })
                          .then(() => {
                            setMemories((current) => current.filter((entry) => entry.id !== memory.id));
                            setEditingId((current) => (current === memory.id ? null : current));
                          })
                          .catch((deleteError) => setError(errorMessage(deleteError)))
                          .finally(() => setDeletingId(null));
                      }
                    },
                    deletingId === memory.id ? 'Deleting…' : 'Delete'
                  )
                )
              );
              if (editingId !== memory.id) return [row];
              return [
                row,
                React.createElement(
                  'tr',
                  { key: `${memory.id}-editor` },
                  React.createElement(
                    'td',
                    { colSpan: 3, style: { padding: 8 } },
                    React.createElement(MemoryEditor, {
                      memory,
                      rpc,
                      React,
                      onCancel: () => setEditingId(null),
                      onSaved: (updated) => {
                        setMemories((current) =>
                          current.map((entry) => (entry.id === updated.id ? updated : entry))
                        );
                        setEditingId(null);
                      }
                    })
                  )
                )
              ];
            })
          )
        )
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: 'memory',
      title: 'Memory',
      description: 'Review and manage provider-independent global and project memories.',
      component: MemorySettings
    });
  }
};

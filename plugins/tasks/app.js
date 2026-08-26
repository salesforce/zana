function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}

function TasksBoard(props) {
  const React = hostReact();
  if (!React) return null;
  const { useEffect, useState } = React;
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  const refresh = () => {
    globalThis.__ZCC_PLUGIN_HOST__
      ?.callRpc(props.pluginId, 'list', {})
      .then((result) => setItems(result?.items ?? []))
      .catch(() => {});
  };
  useEffect(() => {
    refresh();
  }, [props.pluginId]);
  return React.createElement(
    'div',
    { style: { padding: 24, height: '100%', boxSizing: 'border-box' } },
    React.createElement('h2', { style: { marginTop: 0 } }, 'Tasks'),
    React.createElement(
      'form',
      {
        onSubmit: (event) => {
          event.preventDefault();
          const next = title.trim();
          if (!next) return;
          globalThis.__ZCC_PLUGIN_HOST__
            ?.callRpc(props.pluginId, 'add', { title: next })
            .then(() => {
              setTitle('');
              refresh();
            });
        },
        style: { display: 'flex', gap: 8, marginBottom: 16 }
      },
      React.createElement('input', {
        value: title,
        onChange: (event) => setTitle(event.target.value),
        placeholder: 'Add a task',
        style: { flex: 1 }
      }),
      React.createElement('button', { type: 'submit' }, 'Add')
    ),
    items.length === 0
      ? React.createElement('p', { style: { color: 'var(--text-muted)' } }, 'No tasks yet.')
      : React.createElement(
          'ul',
          { style: { listStyle: 'none', padding: 0, margin: 0 } },
          items.map((item) =>
            React.createElement(
              'li',
              { key: item.id, style: { marginBottom: 8 } },
              React.createElement(
                'label',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: Boolean(item.done),
                  onChange: () => {
                    globalThis.__ZCC_PLUGIN_HOST__
                      ?.callRpc(props.pluginId, 'toggle', { id: item.id })
                      .then(refresh);
                  }
                }),
                React.createElement(
                  'span',
                  { style: { textDecoration: item.done ? 'line-through' : 'none' } },
                  item.title
                )
              )
            )
          )
        )
  );
}

export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.navPanel({
      id: 'main',
      title: 'Tasks',
      icon: 'ListTodo',
      component: TasksBoard
    });
    app.slots.threadPanelAction({
      id: 'board',
      title: 'Tasks',
      layout: 'padded',
      component: TasksBoard
    });
    app.slots.messageDirective({
      id: 'task',
      component: function TaskDirective(props) {
        const React = hostReact();
        if (!React) return null;
        const title = props.attributes.title || props.attributes.id || 'Task';
        return React.createElement('div', { className: 'plugin-directive' }, title);
      }
    });
  }
};

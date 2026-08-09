export default {
  activate({ React, host }) {
    const { createElement: h, useState } = React;

    function Panel() {
      const [count, setCount] = useState(0);
      const scope = host.getScopedProjectId?.() ?? null;
      return h(
        'main',
        { style: { height: '100%', overflow: 'auto', padding: 24, boxSizing: 'border-box' } },
        h('h2', null, '__EXT_TITLE__'),
        h('p', null, scope ? `Project view: ${scope}` : 'Global view'),
        h(
          'button',
          { className: 'btn', onClick: () => setCount((value) => value + 1) },
          `Clicked ${count} times`
        )
      );
    }

    return { panel: Panel };
  }
};

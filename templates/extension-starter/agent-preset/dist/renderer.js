export default {
  activate({ React, host }) {
    const { createElement: h } = React;

    function Panel() {
      return h(
        'main',
        { style: { height: '100%', overflow: 'auto', padding: 24, boxSizing: 'border-box' } },
        h('h2', null, '__EXT_TITLE__'),
        h('p', null, 'Edit agentPreset in extension.json, then reload from source.')
      );
    }

    return { panel: Panel };
  }
};

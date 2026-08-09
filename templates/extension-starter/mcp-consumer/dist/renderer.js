export default {
  activate({ React, host }) {
    const { createElement: h, useEffect, useState } = React;

    function Panel() {
      const [items, setItems] = useState([]);
      useEffect(() => {
        host.call('listItems').then(setItems).catch(() => setItems([]));
      }, []);
      return h(
        'main',
        { style: { height: '100%', overflow: 'auto', padding: 24, boxSizing: 'border-box' } },
        h('h2', null, '__EXT_TITLE__'),
        h('p', null, items.length ? `Received ${items.length} item(s).` : 'No items returned.')
      );
    }

    return { panel: Panel };
  }
};

export default {
  activate({ React, host }) {
    const { createElement: h, useEffect, useState } = React;

    function Panel() {
      const [result, setResult] = useState('Checking git…');
      useEffect(() => {
        host.call('gitVersion').then(setResult).catch((error) => setResult(String(error)));
      }, []);
      return h(
        'main',
        { style: { height: '100%', overflow: 'auto', padding: 24, boxSizing: 'border-box' } },
        h('h2', null, '__EXT_TITLE__'),
        h('p', null, result)
      );
    }

    return { panel: Panel };
  }
};

/**
 * Inbox Push Sample — minimal renderer, built against the real
 * `RendererEntry.activate({ React, host })` contract (mirrors the doc example
 * in packages/extension-sdk/src/renderer.ts). Renders a fixed marker div so
 * the E2E spec can assert the project tab actually mounted.
 */
export default {
  activate({ React }) {
    return function Panel() {
      return React.createElement('div', { className: 'inbox-push-sample-panel' }, 'Inbox Push Sample');
    };
  }
};

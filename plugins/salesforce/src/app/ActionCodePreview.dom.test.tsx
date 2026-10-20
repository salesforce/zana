/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ActionCodePreview } from './ActionCodePreview.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

afterEach(cleanup);

function ready(frame: HTMLIFrameElement) {
  const post = vi.fn();
  Object.defineProperty(frame, 'contentWindow', { configurable: true, value: { postMessage: post } });
  window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.contentWindow as Window, data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' } }));
  return post;
}

describe('ActionCodePreview', () => {
  it('opens Apex at its @InvocableMethod with the default title', () => {
    const { container } = render(<ActionCodePreview content={'class A {\n  @InvocableMethod\n  static void run() {}\n}'} language="apex" />);
    const frame = container.querySelector('iframe')!;
    expect(frame.title).toBe('Action implementation source');
    expect(frame.className).toBe('af-action-code');
    expect(ready(frame)).toHaveBeenCalledWith(expect.objectContaining({ type: 'reference', language: 'apex', line: 2 }), location.origin);
  });

  it('shows Agent Script at the requested line, else the first', () => {
    const { container, rerender } = render(<ActionCodePreview content="system:" language="agentscript" line={9} title="Agent Script source" className="sf-agent-opener-code" />);
    const frame = container.querySelector('iframe')!;
    expect(frame.title).toBe('Agent Script source');
    const post = ready(frame);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'agentscript', content: 'system:', line: 9 }), location.origin);
    rerender(<ActionCodePreview content="config:" language="agentscript" />);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ content: 'config:', line: 1 }), location.origin);
  });
});

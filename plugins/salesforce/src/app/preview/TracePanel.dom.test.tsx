/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TurnTrace } from '../../../lib/studio-contract.js';
import { TracePanel } from './TracePanel.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
function render(el: React.ReactElement) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

const trace: TurnTrace = {
  runId: 'r', turn: 1, planId: 'p', available: true,
  steps: [
    { kind: 'input', label: 'User input', inputPreview: 'hi' },
    { kind: 'topic', label: 'Orders', latencyMs: 40, source: { path: 'a.agent', line: 7 } },
    { kind: 'action', label: 'GetOrder', latencyMs: 120, inputPreview: 'id=1', outputPreview: 'ok' },
    { kind: 'variable', label: 'x', outputPreview: '1' }
  ]
};

describe('TracePanel', () => {
  it('shows the approximation label for rehearse', () => {
    const el = render(<TracePanel trace={null} approximation />);
    expect(el.textContent).toContain('Approximation');
  });
  it('shows loading, nothing, and unavailable reasons', () => {
    expect(render(<TracePanel trace={null} loading />).textContent).toContain('Loading trace');
    act(() => root!.unmount()); host!.remove();
    expect(render(<TracePanel trace={null} />).textContent).toBe('');
    act(() => root!.unmount()); host!.remove();
    expect(render(<TracePanel trace={{ ...trace, available: false, reason: 'gone', steps: [] }} />).textContent).toContain('gone');
    act(() => root!.unmount()); host!.remove();
    expect(render(<TracePanel trace={{ ...trace, available: false, steps: [] }} />).textContent).toContain('No runtime trace');
  });
  it('renders steps, nesting, latency bars and reveals source', () => {
    const onReveal = vi.fn();
    const el = render(<TracePanel trace={{ ...trace, reason: 'Showing 4 of 9 steps.' }} onRevealSource={onReveal} />);
    expect(el.textContent).toContain('4 steps');
    expect(el.textContent).toContain('0.16s total');
    expect(el.textContent).toContain('Showing 4 of 9 steps.');
    expect(el.querySelectorAll('.sf-trace-bar').length).toBe(2);
    expect(el.querySelectorAll('.is-nested').length).toBe(2);
    const btn = el.querySelector('button.sf-trace-row') as HTMLButtonElement;
    expect(btn.textContent).toContain('L7');
    act(() => btn.click());
    expect(onReveal).toHaveBeenCalledWith('a.agent', 7);
    expect(el.textContent).toContain('id=1');
  });
  it('renders source rows as plain rows without a reveal handler', () => {
    const el = render(<TracePanel trace={trace} />);
    expect(el.querySelector('button.sf-trace-row')).toBeNull();
    expect(el.querySelectorAll('[role=listitem]').length).toBe(4);
  });
});

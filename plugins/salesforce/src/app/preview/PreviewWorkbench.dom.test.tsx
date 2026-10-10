/** @vitest-environment happy-dom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewWorkbench, type PreviewWorkbenchProps } from './PreviewWorkbench.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls: Array<{ method: string; args: Record<string, unknown> }> = [];
let realtime: ((p: unknown) => void) | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;

const snap = (turns: Array<Record<string, unknown>>) => ({ ok: true, data: { id: 'sess-1', turns } });
const suiteRow = (extra: Record<string, unknown> = {}) => ({
  id: 'A', path: 'tests/A.scenario.json', sha256: 'sha1',
  cases: [{ id: 'c1', name: 'Refund', utterances: ['hi'], expect: {} }, { id: 'c2', name: 'Other', utterances: ['yo'], expect: {} }],
  lastResults: { c1: { outcome: 'pass', runId: 'r', at: 1 } }, ...extra
});

beforeEach(() => {
  calls.length = 0; realtime = null;
  handlers = {
    'agentLab.start': () => snap([{ role: 'agent', text: 'Welcome' }]),
    'agentLab.send': () => snap([{ role: 'agent', text: 'Welcome' }, { role: 'user', text: 'hello' }, { role: 'agent', text: 'Hi there', planId: 'p1', latencyMs: 1200 }]),
    'agentLab.end': () => ({ ok: true }),
    'agentLab.trace': () => ({ ok: true, data: { runId: 'sess-1', turn: 1, planId: 'p1', available: true, steps: [{ kind: 'topic', label: 'Orders', source: { path: 'a.agent', line: 3 } }] } }),
    'studio.suites.list': () => ({ ok: true, suites: [suiteRow()] }),
    'studio.suites.save': (a) => ({ ok: true, suite: suiteRow({ cases: a.cases, sha256: 'sha2' }) }),
    'studio.suites.run': () => ({ ok: true, suite: suiteRow({ lastResults: { c1: { outcome: 'fail', runId: 'r', at: 2 }, c2: { outcome: 'pass', runId: 'r', at: 2 } } }) }),
    'agentPreview.start': () => ({ ok: true, data: { sessionId: 'live-1' } }),
    'agentPreview.send': () => ({ ok: true, data: { response: 'Live reply', planId: 'lp' } }),
    'agentPreview.end': () => ({ ok: true })
  };
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__ = {
    callRpc: async (_p: string, method: string, args: Record<string, unknown>) => {
      calls.push({ method, args });
      const h = handlers[method];
      return h ? h(args) : { ok: false, error: `unexpected ${method}` };
    },
    setSettings: async () => undefined
  };
  (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__ = {
    useZccContext: () => ({ projectId: 'proj-1' }),
    useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; },
    useRealtimeConnectionState: () => 'connected'
  };
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:x');
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
});
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = null; host = null;
  delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_HOST__;
  delete (globalThis as Record<string, unknown>).__ZCC_PLUGIN_RUNTIME__;
});

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
async function mount(props: Partial<PreviewWorkbenchProps> = {}) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PreviewWorkbench, { pluginId: 'salesforce', projectId: 'proj-1', source: 'agent_label: x', fileLabel: 'A.agent', path: 'force-app/A.agent', ...props }));
  });
  await flush();
  return host;
}
const btn = (el: HTMLElement, text: string) => {
  const all = [...el.querySelectorAll('button')].filter(b => b.textContent?.trim().startsWith(text));
  return (text === 'trace' ? all[all.length - 1] : all[0]) as HTMLButtonElement;
};
const click = async (b: HTMLElement | undefined) => { expect(b).toBeTruthy(); await act(async () => { b!.click(); }); await flush(); };
async function typeAndSend(el: HTMLElement, text: string) {
  const input = el.querySelector('input[aria-label="Preview message"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { (el.querySelector('form.sf-pw-composer') as HTMLFormElement).requestSubmit(); });
  await flush();
}
const methods = () => calls.map(c => c.method);

describe('PreviewWorkbench', () => {
  it('loads the suite and shows chips with state', async () => {
    const el = await mount();
    expect(el.textContent).toContain('1/2 pass');
    const chips = [...el.querySelectorAll('.sf-pw-chip')];
    expect(chips.map(c => c.getAttribute('data-state'))).toEqual(['pass', 'unrun']);
    expect(calls.find(c => c.method === 'studio.suites.list')?.args).toMatchObject({ agentPath: 'force-app/A.agent', projectId: 'proj-1' });
  });

  it('switches engines and runs the rehearse flow with an approximation trace', async () => {
    const onRun = vi.fn(); const onEngine = vi.fn();
    const el = await mount({ onRunChange: onRun, onEngineChange: onEngine });
    await click(btn(el, 'Rehearse'));
    expect(onEngine).toHaveBeenCalledWith('rehearse');
    await click(btn(el, 'Start'));
    expect(calls.find(c => c.method === 'agentLab.start')?.args).toMatchObject({ engine: 'rehearsal' });
    expect(el.textContent).toContain('Welcome');
    await typeAndSend(el, 'hello');
    expect(el.textContent).toContain('Hi there');
    await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Approximation');
    expect(methods()).not.toContain('agentLab.trace');
    expect(onRun).toHaveBeenLastCalledWith({ runId: 'sess-1', engine: 'rehearse', turn: 1 });
    await click(btn(el, 'End'));
    expect(methods()).toContain('agentLab.end');
    expect(onRun).toHaveBeenLastCalledWith(null);
  });

  it('simulate fetches a trace once and reveals the source line', async () => {
    const reveal = vi.fn();
    const el = await mount({ onRevealSource: reveal });
    await click(btn(el, 'Start'));
    expect(calls.find(c => c.method === 'agentLab.start')?.args).toMatchObject({ engine: 'preview' });
    await typeAndSend(el, 'hello');
    await click(btn(el, 'trace'));
    expect(calls.filter(c => c.method === 'agentLab.trace')).toHaveLength(1);
    expect(calls.find(c => c.method === 'agentLab.trace')?.args).toMatchObject({ id: 'sess-1', planId: 'p1', path: 'force-app/A.agent' });
    expect(el.textContent).toContain('Orders');
    await click(el.querySelector('button.sf-trace-row') as HTMLElement);
    expect(reveal).toHaveBeenCalledWith('a.agent', 3);
    await click(btn(el, 'trace')); // collapse
    await click(btn(el, 'trace')); // reopen: cached
    expect(calls.filter(c => c.method === 'agentLab.trace')).toHaveLength(1);
  });

  it('after End keeps fetched traces and explains why an untraced reply has none', async () => {
    handlers['agentLab.send'] = () => snap([{ role: 'user', text: 'a' }, { role: 'agent', text: 'One', planId: 'p1' }, { role: 'user', text: 'b' }, { role: 'agent', text: 'Two', planId: 'p2' }]);
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'b');
    const traceButtons = () => [...el.querySelectorAll('button')].filter(b => b.textContent?.startsWith('trace')) as HTMLButtonElement[];
    await click(traceButtons()[0]);
    expect(el.textContent).toContain('Orders');
    await click(btn(el, 'End'));
    await click(traceButtons()[1]);
    expect(calls.filter(c => c.method === 'agentLab.trace')).toHaveLength(1);
    expect(el.textContent).toContain('This run has ended, so its runtime trace is no longer available.');
    expect(el.textContent).toContain('Orders');
  });

  it('degrades when the trace is unavailable or throws', async () => {
    handlers['agentLab.trace'] = () => ({ ok: false, error: 'nope' });
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'trace'));
    expect(el.textContent).toContain('nope');
  });

  it('shows no-plan-id reason for turns without a plan', async () => {
    handlers['agentLab.send'] = () => snap([{ role: 'user', text: 'hello' }, { role: 'agent', text: 'plain' }]);
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'trace'));
    expect(el.textContent).toContain('no plan id');
  });

  it('runs Live through agentPreview.* and blocks without a path', async () => {
    const el = await mount({ engine: 'live' });
    await click(btn(el, 'Start'));
    expect(calls.find(c => c.method === 'agentPreview.start')?.args).toMatchObject({ live: true, path: 'force-app/A.agent' });
    await typeAndSend(el, 'go');
    expect(el.textContent).toContain('Live reply');
    await click(btn(el, 'End'));
    expect(calls.find(c => c.method === 'agentPreview.end')?.args).toMatchObject({ sessionId: 'live-1', live: true });
    act(() => root!.unmount()); host!.remove();
    const blocked = await mount({ engine: 'live', path: undefined });
    expect(btn(blocked, 'Start').disabled).toBe(true);
    expect(blocked.textContent).toContain('Open a saved .agent file');
  });

  it('surfaces start failures', async () => {
    handlers['agentLab.start'] = () => ({ ok: false, error: 'boom' });
    const el = await mount();
    await click(btn(el, 'Start'));
    expect(el.querySelector('[role=alert]')?.textContent).toContain('boom');
  });

  it('runs the suite, reruns one case and reloads on realtime', async () => {
    const el = await mount();
    await click(btn(el, 'Run suite'));
    expect(calls.find(c => c.method === 'studio.suites.run')?.args).toMatchObject({ path: 'tests/A.scenario.json', engine: 'preview', source: 'agent_label: x' });
    expect([...el.querySelectorAll('.sf-pw-chip')].map(c => c.getAttribute('data-state'))).toEqual(['fail', 'pass']);
    await click(btn(el, '✗ Refund'));
    expect(calls.filter(c => c.method === 'studio.suites.run').pop()?.args).toMatchObject({ caseIds: ['c1'] });
    const before = calls.filter(c => c.method === 'studio.suites.list').length;
    await act(async () => { realtime?.({ kind: 'comments' }); }); await flush();
    expect(calls.filter(c => c.method === 'studio.suites.list').length).toBe(before);
    await act(async () => { realtime?.({ kind: 'suites', projectId: 'proj-1' }); }); await flush();
    expect(calls.filter(c => c.method === 'studio.suites.list').length).toBe(before + 1);
  });

  it('reports suite run failures', async () => {
    handlers['studio.suites.run'] = () => ({ ok: false, error: 'busy' });
    const el = await mount();
    await click(btn(el, 'Run suite'));
    expect(el.querySelector('[role=alert]')?.textContent).toContain('busy');
  });

  it('saves a conversation as a scenario with the current sha', async () => {
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'trace'));
    await click(btn(el, 'Save as scenario'));
    const form = el.querySelector('form[aria-label="Save as scenario"]') as HTMLFormElement;
    const name = form.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(name, 'My flow'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { form.requestSubmit(); }); await flush();
    const save = calls.find(c => c.method === 'studio.suites.save')!;
    expect(save.args).toMatchObject({ agentPath: 'force-app/A.agent', expectedSha256: 'sha1' });
    const cases = save.args.cases as Array<{ name: string; utterances: string[]; expect: { topic?: string } }>;
    expect(cases).toHaveLength(3);
    expect(cases[2]).toMatchObject({ name: 'My flow', utterances: ['hello'], expect: { topic: 'Orders' } });
    expect(el.querySelector('form[aria-label="Save as scenario"]')).toBeNull();
  });

  it('surfaces save conflicts', async () => {
    handlers['studio.suites.save'] = () => ({ ok: false, error: 'sha_mismatch' });
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await click(btn(el, 'Save as scenario'));
    const form = el.querySelector('form[aria-label="Save as scenario"]') as HTMLFormElement;
    const name = form.querySelector('input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(name, 'x'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { form.requestSubmit(); }); await flush();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('sha_mismatch');
  });

  it('compares two runs, exports a run and flags stale source', async () => {
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'End'));
    handlers['agentLab.start'] = () => ({ ok: true, data: { id: 'sess-2', turns: [] } });
    handlers['agentLab.send'] = () => ({ ok: true, data: { id: 'sess-2', turns: [{ role: 'user', text: 'hello' }, { role: 'agent', text: 'Different', planId: 'p9' }] } });
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await click(btn(el, 'Compare runs'));
    expect(el.querySelector('[aria-label="Compare runs"]')).toBeTruthy();
    expect(el.textContent).toContain('differs');
    expect(el.querySelector('[data-testid=cmp-a]')?.textContent).toContain('Different');
    const select = el.querySelector('select[aria-label="Run B"]') as HTMLSelectElement;
    await act(async () => { select.value = select.options[0].value; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await click(btn(el, 'Export run'));
    expect((URL.createObjectURL as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    await click(btn(el, 'Compare runs'));
    expect(el.querySelector('[aria-label="Compare runs"]')).toBeNull();
  });

  it('warns when the script changes during a run', async () => {
    const el = await mount();
    await click(btn(el, 'Start'));
    await act(async () => { root!.render(createElement(PreviewWorkbench, { pluginId: 'salesforce', projectId: 'proj-1', source: 'changed', fileLabel: 'A.agent', path: 'force-app/A.agent' })); });
    expect(el.textContent).toContain('Your script changed');
  });

  it('ends the session on unmount', async () => {
    const el = await mount();
    await click(btn(el, 'Start'));
    act(() => root!.unmount()); root = null;
    await flush();
    expect(calls.filter(c => c.method === 'agentLab.end')).toHaveLength(1);
    el.remove();
  });

  describe('host commands', () => {
    const render = async (props: Partial<PreviewWorkbenchProps>) => {
      await act(async () => {
        root!.render(createElement(PreviewWorkbench, { pluginId: 'salesforce', projectId: 'proj-1', source: 'agent_label: x', fileLabel: 'A.agent', path: 'force-app/A.agent', ...props }));
      });
      await flush();
    };

    it('starts a session in the selected engine and runs each seq once', async () => {
      await mount({ engine: 'simulate' });
      await render({ engine: 'simulate', command: { seq: 1, type: 'start' } });
      expect(calls.filter(c => c.method === 'agentLab.start')).toHaveLength(1);
      expect(calls.find(c => c.method === 'agentLab.start')!.args.engine).toBe('preview');
      await render({ engine: 'simulate', command: { seq: 1, type: 'start' } });
      expect(calls.filter(c => c.method === 'agentLab.start')).toHaveLength(1);
    });

    it('send starts a session when none is running, then sends the text', async () => {
      const el = await mount({ engine: 'rehearse' });
      await render({ engine: 'rehearse', command: { seq: 1, type: 'send', text: 'hello' } });
      expect(calls.map(c => c.method).filter(m => m.startsWith('agentLab.') && m !== 'agentLab.end')).toEqual(['agentLab.start', 'agentLab.send']);
      expect(calls.find(c => c.method === 'agentLab.send')!.args.text).toBe('hello');
      expect(el.textContent).toContain('Hi there');
    });

    it('waits for the controlled engine, and sends through the live engine', async () => {
      await mount({ engine: 'rehearse' });
      await render({ engine: 'rehearse', command: { seq: 1, type: 'send', text: 'hi live', engine: 'live' } });
      expect(calls.filter(c => c.method.endsWith('.start'))).toHaveLength(0);
      await render({ engine: 'live', command: { seq: 1, type: 'send', text: 'hi live', engine: 'live' } });
      expect(calls.find(c => c.method === 'agentPreview.start')).toBeTruthy();
      expect(calls.find(c => c.method === 'agentPreview.send')!.args).toMatchObject({ sessionId: 'live-1', utterance: 'hi live' });
    });

    it('surfaces failures instead of throwing, for empty text and live without a path', async () => {
      const el = await mount({ engine: 'rehearse' });
      await render({ engine: 'rehearse', command: { seq: 1, type: 'send', text: '  ' } });
      expect(el.textContent).toContain('preview.send needs text');
      await render({ engine: 'live', path: undefined, command: { seq: 2, type: 'start', engine: 'live' } });
      expect(el.textContent).toContain('Live preview needs a saved .agent file');
    });
  });
});

const setInput = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const alertText = (el: HTMLElement) => el.querySelector('[role=alert]')?.textContent ?? '';
const rerender = async (props: Partial<PreviewWorkbenchProps>) => {
  await act(async () => { root!.render(createElement(PreviewWorkbench, { pluginId: 'salesforce', projectId: 'proj-1', source: 'agent_label: x', fileLabel: 'A.agent', path: 'force-app/A.agent', ...props })); });
  await flush();
};

describe('PreviewWorkbench failure paths and edge cases', () => {
  it('treats an empty RPC response and a missing lab snapshot as start failures', async () => {
    handlers['agentLab.start'] = () => undefined;
    const el = await mount();
    await click(btn(el, 'Start'));
    expect(alertText(el)).toContain('No response.');
    handlers['agentLab.start'] = () => ({ ok: false });
    await click(btn(el, 'Start'));
    expect(alertText(el)).toContain('The preview could not start.');
    expect(btn(el, 'End')).toBeUndefined();
  });

  it('reports a live start without a session id and surfaces thrown non-Error values', async () => {
    handlers['agentPreview.start'] = () => ({ ok: true, data: { sessionId: null } });
    const el = await mount({ engine: 'live', orgAlias: 'dev' });
    expect(el.textContent).toContain('Live runs real actions on dev');
    await click(btn(el, 'Start'));
    expect(alertText(el)).toContain('Live preview could not start.');
    handlers['agentPreview.start'] = () => { throw 'plain string failure'; };
    await click(btn(el, 'Start'));
    expect(alertText(el)).toContain('plain string failure');
    expect(el.textContent).not.toContain('Start a run');
  });

  it('describes engines in the hint and live without an org', async () => {
    const el = await mount({ engine: 'simulate' });
    expect(el.textContent).toContain('Actions are simulated');
    await rerender({ engine: 'live' });
    expect(el.textContent).toContain('on the connected org');
    await rerender({ engine: 'rehearse' });
    expect(el.textContent).toContain('An AI model plays your script');
  });

  it('keeps Start disabled for a blank draft and shows the placeholder when idle', async () => {
    const el = await mount({ source: '   ', fileLabel: '' });
    expect(btn(el, 'Start').disabled).toBe(true);
    expect(el.textContent).toContain('Current draft');
    expect((el.querySelector('input[aria-label="Preview message"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('does nothing when submitting an empty message and shows Starting while a run starts', async () => {
    let release!: (v: unknown) => void;
    handlers['agentLab.start'] = () => new Promise(r => { release = r; });
    const el = await mount();
    await act(async () => { (el.querySelector('form.sf-pw-composer') as HTMLFormElement).requestSubmit(); }); await flush();
    expect(methods()).not.toContain('agentLab.send');
    await click(btn(el, 'Start'));
    expect(el.textContent).toContain('Starting…');
    await act(async () => release(snap([]))); await flush();
    await act(async () => { (el.querySelector('form.sf-pw-composer') as HTMLFormElement).requestSubmit(); }); await flush();
    expect(methods()).not.toContain('agentLab.send');
    expect(btn(el, 'End')).toBeTruthy();
  });

  it('surfaces lab send failures with and without an error message', async () => {
    const el = await mount();
    await click(btn(el, 'Start'));
    handlers['agentLab.send'] = () => ({ ok: false });
    await typeAndSend(el, 'one');
    expect(alertText(el)).toContain('The agent did not respond.');
    handlers['agentLab.send'] = () => ({ ok: false, error: 'rate limited' });
    await typeAndSend(el, 'two');
    expect(alertText(el)).toContain('rate limited');
  });

  it('handles live replies: errors, empty replies and replies without a plan id', async () => {
    const el = await mount({ engine: 'live' });
    await click(btn(el, 'Start'));
    handlers['agentPreview.send'] = () => ({ ok: false });
    await typeAndSend(el, 'a');
    expect(alertText(el)).toContain('The agent did not respond.');
    handlers['agentPreview.send'] = () => ({ ok: false, error: 'org offline' });
    await typeAndSend(el, 'b');
    expect(alertText(el)).toContain('org offline');
    handlers['agentPreview.send'] = () => ({ ok: true, data: { response: '   ' } });
    await typeAndSend(el, 'c');
    expect(el.querySelectorAll('[data-role=agent]')).toHaveLength(0);
    handlers['agentPreview.send'] = () => ({ ok: true });
    await typeAndSend(el, 'd');
    expect(el.querySelectorAll('[data-role=agent]')).toHaveLength(0);
    handlers['agentPreview.send'] = () => ({ ok: true, data: { response: 'no plan here' } });
    await typeAndSend(el, 'e');
    expect(el.textContent).toContain('no plan here');
    await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Live runs do not return a planner trace here');
    expect(methods()).not.toContain('agentLab.trace');
  });

  it('releases a live session on unmount and ignores end failures', async () => {
    handlers['agentPreview.end'] = () => { throw new Error('gone'); };
    const el = await mount({ engine: 'live' });
    await click(btn(el, 'Start'));
    act(() => root!.unmount()); root = null;
    await flush();
    expect(calls.find(c => c.method === 'agentPreview.end')?.args).toMatchObject({ sessionId: 'live-1', live: true });
    el.remove();
  });

  it('closes the previous session when a host start command arrives mid-run', async () => {
    const el = await mount({ engine: 'simulate' });
    await click(btn(el, 'Start'));
    handlers['agentLab.start'] = () => ({ ok: true, data: { id: 'sess-2', turns: [] } });
    await rerender({ engine: 'simulate', command: { seq: 5, type: 'start' } });
    expect(calls.filter(c => c.method === 'agentLab.start')).toHaveLength(2);
    expect(calls.find(c => c.method === 'agentLab.end')?.args).toMatchObject({ id: 'sess-1' });
    expect(el.querySelector('[role=alert]')).toBeNull();
  });

  it('restarts when a send command targets a different engine than the active session', async () => {
    const el = await mount({ engine: 'rehearse' });
    await click(btn(el, 'Start'));
    await rerender({ engine: 'live', command: { seq: 2, type: 'send', text: 'switch' } });
    expect(calls.find(c => c.method === 'agentPreview.start')).toBeTruthy();
    expect(calls.find(c => c.method === 'agentPreview.send')?.args).toMatchObject({ utterance: 'switch' });
    expect(el.querySelector('[role=alert]')).toBeNull();
  });

  it('ignores unrelated or malformed realtime payloads and reloads for global suite changes', async () => {
    await mount();
    const before = () => calls.filter(c => c.method === 'studio.suites.list').length;
    const start = before();
    await act(async () => { realtime?.(null); }); await flush();
    await act(async () => { realtime?.({ kind: 'suites', projectId: 'someone-else' }); }); await flush();
    expect(before()).toBe(start);
    await act(async () => { realtime?.({ kind: 'suites' }); }); await flush();
    expect(before()).toBe(start + 1);
  });

  it('tolerates failing or malformed suite listings and skips them without a path', async () => {
    handlers['studio.suites.list'] = () => { throw new Error('offline'); };
    let el = await mount();
    expect(el.querySelector('.sf-pw-suite')).toBeNull();
    act(() => root!.unmount()); host!.remove();
    handlers['studio.suites.list'] = () => ({ ok: true, suites: [] });
    el = await mount();
    expect(el.querySelector('.sf-pw-suite')).toBeNull();
    act(() => root!.unmount()); host!.remove();
    handlers['studio.suites.list'] = () => ({ ok: true, suites: 'nope' });
    el = await mount();
    expect(el.querySelector('.sf-pw-suite')).toBeNull();
    act(() => root!.unmount()); host!.remove();
    calls.length = 0;
    el = await mount({ path: undefined });
    expect(methods()).not.toContain('studio.suites.list');
  });

  it('reports suite run failures of every shape and shows progress for single cases', async () => {
    let release!: (v: unknown) => void;
    handlers['studio.suites.run'] = () => new Promise(r => { release = r; });
    const el = await mount();
    await click(btn(el, 'Run suite'));
    expect(el.querySelector('.sf-pw-suite')?.textContent).toContain('Running 2 cases…');
    expect([...el.querySelectorAll('.sf-pw-chip')].every(c => (c as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => release({ ok: false })); await flush();
    expect(alertText(el)).toContain('The suite could not run.');
    handlers['studio.suites.run'] = () => new Promise(r => { release = r; });
    await click(btn(el, 'Other'));
    expect(el.querySelector('.sf-pw-suite')?.textContent).toContain('Running case…');
    await act(async () => release({ ok: true, suite: suiteRow({ sha256: 'newer', lastResults: { c1: { outcome: 'pass', runId: 'r', at: 3 } } }) })); await flush();
    expect(el.querySelector('.sf-pw-suite')?.textContent).toContain('1/2 pass');
    handlers['studio.suites.run'] = () => { throw new Error('socket closed'); };
    await click(btn(el, 'Run suite'));
    expect(alertText(el)).toContain('socket closed');
  });

  it('disables suite runs while Live is selected or a run is active', async () => {
    const el = await mount({ engine: 'live' });
    expect(btn(el, 'Run suite').disabled).toBe(true);
    expect([...el.querySelectorAll('.sf-pw-chip')].every(c => (c as HTMLButtonElement).disabled)).toBe(true);
    await rerender({ engine: 'simulate' });
    await click(btn(el, 'Start'));
    expect(btn(el, 'Run suite').disabled).toBe(true);
  });

  async function startAndSave(el: HTMLElement, name: string, criteria = '') {
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await click(btn(el, 'Save as scenario'));
    const form = el.querySelector('form[aria-label="Save as scenario"]') as HTMLFormElement;
    const inputs = form.querySelectorAll('input');
    expect((form.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
    await setInput(inputs[0] as HTMLInputElement, name);
    if (criteria) await setInput(inputs[1] as HTMLInputElement, criteria);
    await act(async () => { form.requestSubmit(); }); await flush();
  }

  it('saves a scenario into an empty suite without an expected sha and keeps the criteria', async () => {
    handlers['studio.suites.list'] = () => ({ ok: true, suites: [] });
    const el = await mount();
    await startAndSave(el, 'First', 'Greets the user');
    const save = calls.find(c => c.method === 'studio.suites.save')!;
    expect(save.args).not.toHaveProperty('expectedSha256');
    const cases = save.args.cases as Array<{ name: string }>;
    expect(cases).toHaveLength(1);
    expect(JSON.stringify(cases[0])).toContain('Greets the user');
    expect(el.querySelector('form[aria-label="Save as scenario"]')).toBeNull();
  });

  it('keeps the save form open and reports an error when saving fails', async () => {
    handlers['studio.suites.save'] = () => ({ ok: false });
    const el = await mount();
    await startAndSave(el, 'Nope');
    expect(alertText(el)).toContain('The scenario could not be saved.');
    expect(el.querySelector('form[aria-label="Save as scenario"]')).toBeTruthy();
    handlers['studio.suites.save'] = () => { throw new Error('disk full'); };
    await act(async () => { (el.querySelector('form[aria-label="Save as scenario"]') as HTMLFormElement).requestSubmit(); }); await flush();
    expect(alertText(el)).toContain('disk full');
  });

  it('cannot save a scenario without a saved file, and toggles the save form', async () => {
    const el = await mount({ path: undefined });
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    expect(btn(el, 'Save as scenario').disabled).toBe(true);
    await rerender({ path: 'force-app/A.agent' });
    await click(btn(el, 'Save as scenario'));
    expect(el.querySelector('form[aria-label="Save as scenario"]')).toBeTruthy();
    await click(btn(el, 'Save as scenario'));
    expect(el.querySelector('form[aria-label="Save as scenario"]')).toBeNull();
  });

  it('does not fetch a trace for rehearse runs, and degrades on thrown trace errors', async () => {
    handlers['agentLab.trace'] = () => { throw new Error('trace exploded'); };
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    expect(el.textContent).toContain('1.2s');
    await click(btn(el, 'trace'));
    expect(el.textContent).toContain('trace exploded');
  });

  it('falls back to a generic reason when a trace returns no data', async () => {
    handlers['agentLab.trace'] = () => ({ ok: true });
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Trace request failed.');
  });

  it('reports non-Error trace failures', async () => {
    handlers['agentLab.trace'] = () => { throw 'string trace failure'; };
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'trace'));
    expect(el.textContent).toContain('string trace failure');
  });

  it('compares runs with no agent replies and switches run A', async () => {
    const el = await mount();
    handlers['agentLab.start'] = () => snap([]);
    handlers['agentLab.send'] = () => ({ ok: true, data: { id: 'sess-1', turns: [{ role: 'user', text: 'only me' }] } });
    await click(btn(el, 'Start')); await typeAndSend(el, 'x'); await click(btn(el, 'End'));
    handlers['agentLab.start'] = () => ({ ok: true, data: { id: 'sess-2', turns: [] } });
    handlers['agentLab.send'] = () => ({ ok: true, data: { id: 'sess-2', turns: [{ role: 'user', text: 'also me' }] } });
    await click(btn(el, 'Start')); await typeAndSend(el, 'y');
    await click(btn(el, 'Compare runs'));
    expect(el.textContent).toContain('No agent replies to compare.');
    const a = el.querySelector('select[aria-label="Run A"]') as HTMLSelectElement;
    await act(async () => { a.value = a.options[1].value; a.dispatchEvent(new Event('change', { bubbles: true })); });
    expect((el.querySelector('select[aria-label="Run A"]') as HTMLSelectElement).value).toBe(a.options[1].value);
  });

  it('shows matching replies as same across two runs', async () => {
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello'); await click(btn(el, 'End'));
    handlers['agentLab.start'] = () => ({ ok: true, data: { id: 'sess-2', turns: [] } });
    handlers['agentLab.send'] = () => ({ ok: true, data: { id: 'sess-2', turns: [{ role: 'agent', text: 'Welcome' }, { role: 'user', text: 'hello' }, { role: 'agent', text: 'Hi there', planId: 'p1' }] } });
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await click(btn(el, 'Compare runs'));
    expect(el.textContent).toContain(' · same');
    expect(el.textContent).not.toContain('differs');
  });
});

describe('PreviewWorkbench run ownership', () => {
  const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

  it('ends the run when another file opens, keeps its conversation and lets a new run start', async () => {
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await rerender({ path: 'force-app/B.agent', fileLabel: 'B.agent' });
    expect(calls.filter(c => c.method === 'agentLab.end').map(c => c.args)).toEqual([expect.objectContaining({ id: 'sess-1' })]);
    expect(el.textContent).toContain('Hi there');
    expect((el.querySelector('input[aria-label="Preview message"]') as HTMLInputElement).disabled).toBe(true);
    await click(btn(el, 'Start'));
    expect(calls.filter(c => c.method === 'agentLab.start')).toHaveLength(2);
  });

  it('keeps the run when a new draft is saved for the first time', async () => {
    const el = await mount({ path: undefined });
    await click(btn(el, 'Start'));
    await rerender({ path: 'force-app/A.agent' });
    expect(methods()).not.toContain('agentLab.end');
    expect(btn(el, 'End')).toBeTruthy();
  });

  it('ends a run whose start resolves after the panel closed', async () => {
    const late = deferred();
    handlers['agentLab.start'] = () => late.promise;
    const el = await mount();
    await act(async () => { btn(el, 'Start').click(); });
    act(() => root!.unmount()); root = null;
    await act(async () => { late.resolve(snap([])); }); await flush();
    expect(calls.find(c => c.method === 'agentLab.end')?.args).toMatchObject({ id: 'sess-1' });
    el.remove();
  });

  it('ends a Live run whose start resolves after another file opened, against the file it started on', async () => {
    const late = deferred();
    handlers['agentPreview.start'] = () => late.promise;
    const el = await mount({ engine: 'live', threadId: 'thr-1' });
    await act(async () => { btn(el, 'Start').click(); });
    await rerender({ engine: 'live', threadId: 'thr-1', path: 'force-app/B.agent' });
    await act(async () => { late.resolve({ ok: true, data: { sessionId: 'live-late' } }); }); await flush();
    expect(calls.find(c => c.method === 'agentPreview.end')?.args).toMatchObject({ sessionId: 'live-late', path: 'force-app/A.agent', threadId: 'thr-1', live: true });
    expect(btn(el, 'Start')).toBeTruthy();
    expect(btn(el, 'End')).toBeUndefined();
  });

  it('releases a Live run with its thread so the end is not refused as headless', async () => {
    const el = await mount({ engine: 'live', threadId: 'thr-1' });
    await click(btn(el, 'Start'));
    act(() => root!.unmount()); root = null;
    await flush();
    expect(calls.find(c => c.method === 'agentPreview.end')?.args).toMatchObject({ projectId: 'proj-1', sessionId: 'live-1', path: 'force-app/A.agent', threadId: 'thr-1', live: true });
    el.remove();
  });

  it('reports a Live end the org did not confirm, but never a lab end', async () => {
    const el = await mount({ engine: 'live', threadId: 'thr-1' });
    await click(btn(el, 'Start'));
    handlers['agentPreview.end'] = () => ({ ok: false, error: 'Operator refused preview.end.' });
    await click(btn(el, 'End'));
    expect(alertText(el)).toBe('The Live session may still be open on the org: Operator refused preview.end.');
    expect(btn(el, 'Start')).toBeTruthy();
    handlers['agentPreview.end'] = () => { throw 'offline'; };
    await click(btn(el, 'Start')); await click(btn(el, 'End'));
    expect(alertText(el)).toBe('The Live session may still be open on the org: offline');
    handlers['agentPreview.end'] = () => null;
    await click(btn(el, 'Start')); await click(btn(el, 'End'));
    expect(alertText(el)).toBe('The Live session may still be open on the org: No response.');
    handlers['agentLab.end'] = () => ({ ok: false, error: 'This run has expired' });
    await rerender({ engine: 'simulate', threadId: 'thr-1' });
    await click(btn(el, 'Start')); await click(btn(el, 'End'));
    expect(alertText(el)).toBe('');
    expect(btn(el, 'Start')).toBeTruthy();
  });

  it('warns that Live runs the saved file while the editor has unsaved changes', async () => {
    const el = await mount({ engine: 'live', dirty: true });
    expect(el.textContent).toContain('It runs the saved file, so save to include your edits.');
    await rerender({ engine: 'live', dirty: false });
    expect(el.textContent).not.toContain('save to include your edits');
    await rerender({ engine: 'simulate', dirty: true });
    expect(el.textContent).not.toContain('save to include your edits');
  });

  it('retries a failed trace on the next expand and keeps a fetched one', async () => {
    handlers['agentLab.trace'] = () => ({ ok: false, error: 'Trace service busy' });
    const el = await mount();
    await click(btn(el, 'Start')); await typeAndSend(el, 'hello');
    await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Trace service busy');
    handlers['agentLab.trace'] = () => ({ ok: true, data: { runId: 'sess-1', turn: 1, planId: 'p1', available: true, steps: [{ kind: 'topic', label: 'Orders' }] } });
    await click(btn(el, 'trace')); await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Orders');
    await click(btn(el, 'trace')); await click(btn(el, 'trace'));
    expect(calls.filter(c => c.method === 'agentLab.trace')).toHaveLength(2);
  });

  it('never asks the lab for a Live trace', async () => {
    const el = await mount({ engine: 'live' });
    await click(btn(el, 'Start')); await typeAndSend(el, 'go');
    await click(btn(el, 'trace'));
    expect(el.textContent).toContain('Live runs do not return a planner trace here. Use Simulate to see how the agent decided.');
    expect(methods()).not.toContain('agentLab.trace');
  });

  it('tells the host once it takes a command', async () => {
    const onCommandHandled = vi.fn();
    await mount({ engine: 'rehearse', onCommandHandled });
    await rerender({ engine: 'rehearse', onCommandHandled, command: { seq: 3, type: 'send', text: 'hi', engine: 'simulate' } });
    expect(onCommandHandled).not.toHaveBeenCalled();
    await rerender({ engine: 'simulate', onCommandHandled, command: { seq: 3, type: 'send', text: 'hi', engine: 'simulate' } });
    expect(onCommandHandled.mock.calls).toEqual([[3]]);
    expect(calls.find(c => c.method === 'agentLab.send')?.args).toMatchObject({ text: 'hi' });
  });
});

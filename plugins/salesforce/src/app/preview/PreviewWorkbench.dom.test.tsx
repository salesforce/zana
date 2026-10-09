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
});

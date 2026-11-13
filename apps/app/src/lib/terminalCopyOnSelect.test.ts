// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCopyOnSelect, type CopyOnSelectOptions } from './terminalCopyOnSelect.js';

const RIGHT_BUTTON = 2;

interface Harness {
  host: HTMLElement;
  selection: { text: string };
  copy: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  onError: ReturnType<typeof vi.fn<(err: unknown) => void>>;
  enabled: { on: boolean };
  dispose: () => void;
}

let harness: Harness;

function setup(overrides: Partial<CopyOnSelectOptions> = {}): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const enabled = { on: true };
  const copy = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  const onError = vi.fn<(err: unknown) => void>();
  const listeners = new Set<() => void>();
  const selection = {
    current: '',
    get text() { return this.current; },
    set text(next: string) {
      if (next === this.current) return;
      this.current = next;
      listeners.forEach((fn) => fn());
    }
  };
  const term = {
    hasSelection: () => selection.text !== '',
    getSelection: () => selection.text,
    onSelectionChange: (fn: () => void) => {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    }
  };
  const handle = registerCopyOnSelect(term, host, { enabled: () => enabled.on, copy, onError, ...overrides });
  return { host, selection, copy, onError, enabled, dispose: () => handle.dispose() };
}

function mouse(target: EventTarget, type: 'mousedown' | 'mouseup', button = 0) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button }));
}

/** A drag inside the terminal that leaves `text` selected, released on `upTarget`. */
async function drag(text: string, upTarget: EventTarget = harness.host) {
  mouse(harness.host, 'mousedown');
  harness.selection.text = text;
  mouse(upTarget, 'mouseup');
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
  harness = setup();
});
afterEach(() => {
  harness.dispose();
  harness.host.remove();
  vi.useRealTimers();
});

describe('registerCopyOnSelect', () => {
  it('copies the selection once when the mouse selection ends', async () => {
    await drag('npm run build');
    expect(harness.copy).toHaveBeenCalledTimes(1);
    expect(harness.copy).toHaveBeenCalledWith('npm run build');
  });

  it('copies when the drag is released outside the terminal', async () => {
    await drag('a long line', document.body);
    expect(harness.copy).toHaveBeenCalledWith('a long line');
  });

  it('reads the selection after the mouseup, once xterm has finalised it', async () => {
    mouse(harness.host, 'mousedown');
    mouse(harness.host, 'mouseup');
    harness.selection.text = 'final';
    expect(harness.copy).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(harness.copy).toHaveBeenCalledWith('final');
  });

  it('does not copy while dragging, before the mouseup', async () => {
    mouse(harness.host, 'mousedown');
    harness.selection.text = 'partial';
    await vi.runAllTimersAsync();
    expect(harness.copy).not.toHaveBeenCalled();
  });

  it('keeps the clipboard when a click clears the selection', async () => {
    await drag('copied');
    await drag('');
    expect(harness.copy.mock.calls).toEqual([['copied']]);
  });

  it('ignores selections that no mouse gesture in the terminal made (search, programs)', async () => {
    harness.selection.text = 'search match';
    mouse(document.body, 'mousedown');
    mouse(document.body, 'mouseup');
    await vi.runAllTimersAsync();
    expect(harness.copy).not.toHaveBeenCalled();
  });

  it('copies once per gesture: a later mouseup elsewhere does not copy again', async () => {
    await drag('one');
    mouse(document.body, 'mouseup');
    await vi.runAllTimersAsync();
    expect(harness.copy).toHaveBeenCalledTimes(1);
  });

  it('does not copy an old selection again when a click leaves it unchanged (mouse tracking)', async () => {
    await drag('first');
    mouse(harness.host, 'mousedown');
    mouse(harness.host, 'mouseup');
    await vi.runAllTimersAsync();
    expect(harness.copy.mock.calls).toEqual([['first']]);
  });

  it('copies again when a new gesture changes the selection', async () => {
    await drag('first');
    await drag('second');
    expect(harness.copy.mock.calls).toEqual([['first'], ['second']]);
  });

  it('ignores the right and middle buttons', async () => {
    harness.selection.text = 'kept';
    mouse(harness.host, 'mousedown', RIGHT_BUTTON);
    mouse(harness.host, 'mouseup', RIGHT_BUTTON);
    await vi.runAllTimersAsync();
    mouse(harness.host, 'mousedown');
    mouse(harness.host, 'mouseup', RIGHT_BUTTON);
    await vi.runAllTimersAsync();
    expect(harness.copy).not.toHaveBeenCalled();
  });

  it('reads the setting live at the end of each gesture', async () => {
    harness.enabled.on = false;
    await drag('off');
    expect(harness.copy).not.toHaveBeenCalled();
    harness.enabled.on = true;
    await drag('on');
    expect(harness.copy).toHaveBeenCalledWith('on');
  });

  it('reports a failed copy', async () => {
    const err = new Error('denied');
    harness.copy.mockRejectedValueOnce(err);
    await drag('text');
    expect(harness.onError).toHaveBeenCalledWith(err);
  });

  it('stops listening and drops a pending copy on dispose', async () => {
    mouse(harness.host, 'mousedown');
    harness.selection.text = 'pending';
    mouse(harness.host, 'mouseup');
    harness.dispose();
    await vi.runAllTimersAsync();
    await drag('after');
    expect(harness.copy).not.toHaveBeenCalled();
  });

  it('does not report a copy that fails after dispose', async () => {
    let reject: (err: unknown) => void = () => {};
    harness.copy.mockReturnValueOnce(new Promise<void>((_, r) => { reject = r; }));
    await drag('slow');
    harness.dispose();
    reject(new Error('late'));
    await vi.runAllTimersAsync();
    expect(harness.onError).not.toHaveBeenCalled();
  });
});

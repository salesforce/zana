// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { installTestPluginRuntime } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { AutoConvergeToggle } from './AutoConvergeToggle.js';
import { createHarness } from './test-harness.js';

afterEach(cleanup);

function mount(rpc: Record<string, (args?: any) => unknown>) {
  const harness = createHarness();
  installTestPluginRuntime({ deepLinkBase: null, rpc });
  (globalThis as { __ZCC_PLUGIN_RUNTIME__: { toast: unknown } }).__ZCC_PLUGIN_RUNTIME__.toast = (message: string, kind = 'info') => { harness.toasts.push({ message, kind } as never); };
  harness.render(<AutoConvergeToggle />);
  return harness;
}

describe('AutoConvergeToggle', () => {
  it('loads the stored value, saves on change and shows the wording', async () => {
    const saved: unknown[] = [];
    mount({ autoConverge: async () => ({ enabled: false }), setAutoConverge: async ({ enabled }) => { saved.push(enabled); return { enabled }; } });
    const toggle = await screen.findByRole('switch', { name: /settle safe peer changes/i });
    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Overlapping edits still require review/)).toBeTruthy();
    fireEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(saved).toEqual([true]);
  });
  it('reverts and toasts when saving fails', async () => {
    const harness = mount({ autoConverge: async () => ({ enabled: true }), setAutoConverge: async () => { throw new Error('write failed'); } });
    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    fireEvent.click(toggle);
    await waitFor(() => expect(harness.toasts.some((t) => /write failed/.test(t.message))).toBe(true));
    expect((toggle as HTMLInputElement).checked).toBe(true);
  });
  it('stays disabled and toasts when the value cannot load', async () => {
    const harness = mount({ autoConverge: async () => { throw new Error('load failed'); } });
    await waitFor(() => expect(harness.toasts.some((t) => /load failed/.test(t.message))).toBe(true));
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ThreadChat host wiring', () => {
  it('forwards leadingContent and messageActions into the embedded thread', () => {
    const source = readFileSync(fileURLToPath(new URL('./plugin-runtime.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('leadingContent={props.leadingContent}');
    expect(source).toContain('messageActions={props.messageActions}');
    expect(source).toContain('includePluginMessageActions={props.includePluginMessageActions ?? false}');
    expect(source).toContain('call: (method: string, args?: unknown) => callPluginRpc(pluginId, method, args)');
    expect(source).toMatch(/useMemo\(\s*\(\) => \(\{[\s\S]*callPluginRpc\(pluginId/);
  });
});

describe('plugin realtime host wiring', () => {
  it('filters signals by plugin and channel, keeps latest handler, and cleans up', () => {
    const source = readFileSync(fileURLToPath(new URL('./plugin-runtime.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("subscribeProductEvent<{ pluginId?: unknown; channel?: unknown; payload?: unknown }>('plugin-signal'");
    expect(source).toContain('signal?.pluginId !== pluginId || signal.channel !== channel');
    expect(source).toContain('handlerRef.current = handler');
    expect(source).toContain('[channel, pluginId]');
  });
});

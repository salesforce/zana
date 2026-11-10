import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { PluginToolPolicyRequest } from '@zana-ai/zcc-plugin-sdk';

export default function plugin(zcc: ZccPluginApi) {
  let mode: 'allow' | 'deny' | 'throw' | 'hang' = 'deny';
  let events: PluginToolPolicyRequest[] = [];
  zcc.rpc.method('setMode', input => {
    const next = (input as { mode?: string })?.mode;
    if (!['allow', 'deny', 'throw', 'hang'].includes(next ?? '')) throw new Error('invalid mode');
    mode = next as typeof mode;
    return { mode };
  });
  zcc.rpc.method('events', () => events);
  zcc.rpc.method('capabilities', input => zcc.sdk.capabilities.forThread(input as { threadId: string }));
  zcc.rpc.method('crash', () => {
    setTimeout(() => process.exit(1), 50);
    return { scheduled: true };
  });
  zcc.hooks.onToolPolicy(request => {
    events = [...events, request].slice(-50);
    if (mode === 'throw') throw new Error('fixture native policy failed');
    if (mode === 'hang') return new Promise<never>(() => {});
    return mode === 'allow' ? { action: 'allow' } : { action: 'deny', reason: 'Aida native veto fixture denied Bash' };
  });
}

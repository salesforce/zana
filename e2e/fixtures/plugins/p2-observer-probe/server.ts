import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import type { PluginToolPolicyRequest, ToolSettledEvent } from '@zana-ai/zcc-plugin-sdk';

/**
 * Test-only observer. It records what the host hands a plugin (dispatch admission requests, tool.settled
 * events, tool policy requests), can reject a dispatch whose prompt text carries a marker, exposes one
 * agent tool, and drives the host-tracked process helper. Manifest variants (promptAccess, toolResults,
 * mcpServers, skills) are set by the spec by rewriting package.json before the app boots.
 */
const MAX_ROWS = 100;

interface DispatchRow {
  surface?: string;
  entry?: string;
  origin?: string;
  hasPrompt: boolean;
  prompt?: { text: string; truncated: boolean; attachmentCount: number };
  decision: 'proceed' | 'reject';
}

export default function plugin(zcc: ZccPluginApi) {
  let rejectMarker = '';
  let dispatches: DispatchRow[] = [];
  let settled: ToolSettledEvent[] = [];
  let policies: Array<{ toolName: string; surface?: string; providerId: string; threadId: string }> = [];
  const push = <T,>(rows: T[], row: T): T[] => [...rows, row].slice(-MAX_ROWS);

  zcc.rpc.method('setRejectMarker', (input) => {
    rejectMarker = String((input as { marker?: unknown })?.marker ?? '');
    return { rejectMarker };
  });
  zcc.rpc.method('dispatchList', () => dispatches);
  zcc.rpc.method('dispatchClear', () => { dispatches = []; return { ok: true }; });
  zcc.hooks.on((request) => {
    const prompt = request.prompt;
    const blocked = rejectMarker !== '' && typeof prompt?.text === 'string' && prompt.text.includes(rejectMarker);
    dispatches = push(dispatches, {
      surface: request.surface, entry: request.entry, origin: request.origin,
      hasPrompt: prompt !== undefined, ...(prompt ? { prompt } : {}), decision: blocked ? 'reject' : 'proceed'
    });
    return blocked ? { action: 'reject', message: 'p2-prompt-blocked' } : { action: 'proceed' };
  });

  zcc.rpc.method('settledList', () => settled);
  zcc.rpc.method('settledClear', () => { settled = []; return { ok: true }; });
  // Subscribing is itself the opt-in for metadata; `outputPreview` additionally needs `zcc.toolResults`.
  zcc.events.on('tool.settled', (event) => { settled = push(settled, event); });

  zcc.rpc.method('policyList', () => policies);
  zcc.hooks.onToolPolicy((request: PluginToolPolicyRequest) => {
    policies = push(policies, { toolName: request.toolName, surface: request.surface, providerId: request.providerId, threadId: request.threadId });
    return { action: 'allow' };
  });

  zcc.agents.registerTool({
    name: 'p2_probe_tool',
    description: 'Harmless test-only tool. Returns a fixed marker.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { ok: true, marker: 'P2_TOOL_RAN' }; }
  });
  zcc.agents.configure(() => ({ tools: ['p2_probe_tool'] }));

  // Process helper. The host discards child output, so each shell writes its own pid files.
  zcc.rpc.method('spawnTree', async (input) => {
    const { dir, name } = input as { dir: string; name: string };
    const script = `sleep 600 & echo $! > "${dir}/${name}.child.pid"; echo $$ > "${dir}/${name}.leader.pid"; wait`;
    const handle = await zcc.process.spawn('sh', ['-c', script], { cwd: dir });
    return { pid: handle.pid };
  });
  zcc.rpc.method('spawnMany', async (input) => {
    const { dir, count } = input as { dir: string; count: number };
    const pids: number[] = [];
    let error: string | undefined;
    for (let index = 0; index < count; index++) {
      try {
        const handle = await zcc.process.spawn('sh', ['-c', `echo $$ > "${dir}/many-${index}.leader.pid"; sleep 600`], { cwd: dir });
        pids.push(handle.pid);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        break;
      }
    }
    return { pids, error };
  });
  zcc.rpc.method('crash', () => {
    setTimeout(() => process.exit(1), 50);
    return { scheduled: true };
  });
}

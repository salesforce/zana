import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { LabSnapshot } from '../../lib/agentforce-lab-contract.js';

export type PreviewResult = {
  ok?: boolean;
  error?: string;
  code?: string;
  data?: { sessionId?: string | null; response?: string };
};

/** Local simulation shares Studio's Preview API, which also supports employee agents without default_agent_user. */
export async function callOrgPreview(
  pluginId: string,
  action: 'start' | 'send' | 'end',
  args: Record<string, unknown>,
  simulated: boolean,
  isCurrent: () => boolean = () => true
): Promise<PreviewResult> {
  if (!simulated) return await callPluginRpc(pluginId, `agentPreview.${action}`, args) as PreviewResult;
  let input: Record<string, unknown> = { ...args, id: args.sessionId, text: args.utterance };
  if (action === 'start') {
    const read = await callPluginRpc(pluginId, 'agentFiles.read', { projectId: args.projectId, path: args.path }) as {
      ok?: boolean; error?: string; file?: { content?: string };
    };
    if (!isCurrent()) return { ok: false };
    if (!read?.ok || typeof read.file?.content !== 'string') return { ok: false, error: read?.error || 'Could not read the selected agent.' };
    input = { ...input, engine: 'preview', source: read.file.content };
  }
  const result = await callPluginRpc(pluginId, `agentLab.${action}`, input) as { ok?: boolean; error?: string; code?: string; data?: LabSnapshot };
  if (!result?.ok || !result.data?.id) return { ok: false, code: result?.code, error: result?.error || 'The preview returned no session.' };
  return {
    ok: true,
    data: {
      sessionId: result.data.id,
      response: action === 'end' ? undefined : result.data.turns?.at(-1)?.role === 'agent' ? result.data.turns.at(-1)!.text : undefined
    }
  };
}

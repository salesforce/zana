import type { PluginApprovalBinding, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { AsyncLocalStorage } from 'node:async_hooks';

export default function plugin(zcc: ZccPluginApi) {
  const binding = { action: 'probe.activate', target: 'test-org', targetLabel: 'Test sandbox', subject: 'Probe Agent', revision: 'revision-1', confirmText: 'sandbox' };
  let changed = 0;
  const outcomes: unknown[] = [];
  const attempts: unknown[] = [];
  let previousToken = '';
  let staleApproval: (() => Promise<unknown>) | undefined;
  const rebuildBinding = async (): Promise<PluginApprovalBinding> => ({ ...binding });
  zcc.rpc.method('state', () => ({ changed, outcomes, attempts }));
  zcc.rpc.method('outsideApproval', () => zcc.ui.requestToolApproval({ binding, title: 'Outside invocation' }));
  zcc.rpc.method('staleApproval', () => staleApproval?.());
  zcc.rpc.method('outsideConsume', () => zcc.ui.consumeApproval({ token: previousToken, binding }));
  zcc.rpc.method('spawn', args => {
    const { projectId, surface } = args as { projectId: string; surface: 'hidden' | 'remote' };
    return zcc.sdk.threads.spawn({ projectId, providerId: 'fake', prompt: 'call_tool:tool_approval_probe',
      title: `Approval ${surface} refusal`, visibility: surface === 'hidden' ? 'hidden' : 'visible',
      ...(surface === 'remote' ? { pluginMetadata: { interactionSurface: { kind: 'remote', label: 'Remote fixture' } } } : {}) });
  });
  zcc.agents.registerTool({
    name: 'tool_approval_probe',
    description: 'Harmless test tool requiring proof before incrementing an in-memory counter.',
    parameters: { type: 'object', properties: { mode: { type: 'string' } }, additionalProperties: false },
    async execute(input, ctx) {
      const mode = (input as { mode?: string }).mode ?? '';
      const crossInvocation = previousToken ? await zcc.ui.consumeApproval({ token: previousToken, binding: await rebuildBinding() }) : false;
      attempts.push({ threadId: ctx.threadId, crossInvocation, desktopPresentation: ctx.desktopPresentation });
      if (crossInvocation) throw new Error('Cross-invocation proof accepted');
      // Retain the worker async context deliberately to test host revocation.
      const restore = AsyncLocalStorage.snapshot();
      staleApproval = () => restore(() => zcc.ui.requestToolApproval({ binding, title: 'Stale invocation' }));
      const approval = await zcc.ui.requestToolApproval({ binding: await rebuildBinding(), title: 'Activate Probe Agent', confirmLabel: 'Activate',
        timeoutMs: mode === 'timeout' ? 3000 : 300000,
        ...(mode === 'forged-scope' ? { threadId: 'forged-thread', invocationId: 'forged-invocation' } : {}) });
      if (!approval.approved) {
        outcomes.push({ threadId: ctx.threadId, approved: false, reason: approval.reason });
        throw new Error(approval.reason);
      }
      previousToken = approval.token;
      if (mode === 'retain-proof') {
        const outcome = { threadId: ctx.threadId, approved: true, consumed: false };
        outcomes.push(outcome);
        return { changed: false, ...outcome };
      }
      if (mode === 'stale-revision') {
        binding.revision = 'revision-2';
        const consumed = await zcc.ui.consumeApproval({ token: approval.token, binding: await rebuildBinding() });
        outcomes.push({ threadId: ctx.threadId, approved: true, consumed });
        if (consumed) throw new Error('Stale revision proof accepted');
        throw new Error('approval required');
      }
      if (mode === 'archived-scope') {
        await zcc.sdk.threads.archive({ threadId: ctx.threadId });
        const consumed = await zcc.ui.consumeApproval({ token: approval.token, binding: await rebuildBinding() });
        outcomes.push({ threadId: ctx.threadId, approved: true, consumed });
        if (consumed) throw new Error('Archived scope proof accepted');
        throw new Error('approval required');
      }
      const tokenParts = approval.token.split('.');
      const badMac = `${tokenParts[0]}.${tokenParts[1]}.${tokenParts[2]![0] === '0' ? '1' : '0'}${tokenParts[2]!.slice(1)}`;
      const macSpoof = await zcc.ui.consumeApproval({ token: badMac, binding: await rebuildBinding() });
      const targetSpoof = await zcc.ui.consumeApproval({ token: approval.token, binding: { ...await rebuildBinding(), target: 'other-org' } });
      const revisionSpoof = await zcc.ui.consumeApproval({ token: approval.token, binding: { ...await rebuildBinding(), revision: 'revision-2' } });
      const invocationSpoof = await zcc.ui.consumeApproval({ token: approval.token, binding: { ...await rebuildBinding(), invocationId: 'forged-invocation' } });
      const consumed = await zcc.ui.consumeApproval({ token: approval.token, binding: await rebuildBinding() });
      const replay = await zcc.ui.consumeApproval({ token: approval.token, binding: await rebuildBinding() });
      if (macSpoof || targetSpoof || revisionSpoof || invocationSpoof || !consumed || replay) throw new Error('Approval proof invariant failed');
      changed++;
      const outcome = { threadId: ctx.threadId, approved: true, consumed, replay, macSpoof, targetSpoof, revisionSpoof, invocationSpoof };
      outcomes.push(outcome);
      // Proof never crosses back into tool output or transcript.
      return { changed: true, ...outcome };
    }
  });
}

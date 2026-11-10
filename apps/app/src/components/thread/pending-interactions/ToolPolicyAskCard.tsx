import { useState } from 'react';
import { parseToolPolicyAskCard } from '@zana-ai/zcc-domain/native-tool-policy-budget';
import { PendingInteractionShell } from './PendingInteractionShell.js';

/**
 * Host-rendered approval for a plugin's `ask` tool-policy decision. The page can
 * only submit a choice; whether it counts as human approval is decided by
 * Electron main's actor proof, so this card cannot grant anything by itself.
 */
export function ToolPolicyAskCard({ data, pluginId, sourceThread, submit, cancel }: {
  data: unknown;
  pluginId: string;
  sourceThread?: { href: string; title: string };
  submit: (value: { decision: 'allow' | 'deny' }) => Promise<void>;
  cancel: () => Promise<void>;
}) {
  const card = parseToolPolicyAskCard(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!card) return null;
  const answer = async (decision: 'allow' | 'deny') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await submit({ decision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not answer this request. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not cancel this request.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <PendingInteractionShell
      title="Approve tool call"
      sourceThread={sourceThread}
      errorMessage={error}
      footerAriaLabel="Tool call approval"
      footer={
        <>
          <button type="button" data-testid="tool-policy-ask-allow" disabled={busy} onClick={() => { void answer('allow'); }}>Allow</button>
          <button type="button" data-testid="tool-policy-ask-deny" disabled={busy} onClick={() => { void answer('deny'); }}>Deny</button>
          <button type="button" data-testid="tool-policy-ask-dismiss" disabled={busy} onClick={() => { void dismiss(); }}>Dismiss</button>
        </>
      }
    >
      <p className="thread-pending-banner-reason" data-testid="tool-policy-ask-prompt">{card.prompt}</p>
      <p className="thread-pending-banner-reason">
        Tool <code>{card.toolName}</code> · requested by plugin <code>{pluginId}</code>. The agent is paused until you answer; no answer denies the call.
      </p>
      {card.inputPreview ? <pre className="thread-pending-banner-preview" data-testid="tool-policy-ask-input">{card.inputPreview}</pre> : null}
    </PendingInteractionShell>
  );
}

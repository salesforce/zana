import { useState, useSyncExternalStore } from 'react';
import {
  isPluginPendingInteraction,
  parseExtensionKind,
  type ExtensionKind,
  type JsonValue,
  type PluginExtensionPendingInteraction,
  type PluginPendingInteraction
} from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';
import { listPendingInteractionSlots, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { PendingInteractionShell } from './PendingInteractionShell.js';
import { QuestionInteractionBanner } from './QuestionInteractionBanner.js';

export function ThreadPluginInteractionBanner({ interaction, threadId, sourceThread }: {
  interaction: PluginPendingInteraction | PluginExtensionPendingInteraction;
  threadId: string;
  sourceThread?: { href: string; title: string };
}) {
  const slots = useSyncExternalStore(subscribePluginSlots, listPendingInteractionSlots, listPendingInteractionSlots);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pluginRequest = isPluginPendingInteraction(interaction);
  const owner = pluginRequest
    ? { pluginId: interaction.origin.pluginId, name: interaction.origin.rendererId }
    : parseExtensionKind(interaction.payload.kind as ExtensionKind);
  const slot = slots.find((entry) => entry.pluginId === owner.pluginId && entry.id === owner.name);

  const resolve = async (value: JsonValue) => {
    if (pluginRequest) {
      await product.threads.interactions.respond(threadId, interaction.id, value);
    } else {
      await product.threads.interactions.resolve(threadId, interaction.id, { kind: 'request_answer', value });
    }
  };
  const cancelRequest = async () => {
    if (pluginRequest) await product.threads.interactions.cancel(threadId, interaction.id);
    else await resolve(null);
  };
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not answer this request. Please try again.');
      throw cause;
    }
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await run(cancelRequest);
    } catch {
      // Plugin forms commonly fire cancel without awaiting it; show the error here.
    } finally {
      setBusy(false);
    }
  };

  const view = {
    id: interaction.id,
    threadId: interaction.threadId,
    title: interaction.payload.title,
    payload: interaction.payload.data,
    createdAt: interaction.createdAt,
    expiresAt: interaction.expiresAt ?? null
  };
  if (slot?.questionForm) {
    const form = slot.questionForm(view);
    return (
      <QuestionInteractionBanner
        key={`${interaction.id}:${slot.generation}`}
        interactionId={interaction.id}
        questions={form.questions}
        threadId={threadId}
        sourceThread={sourceThread}
        resolving={interaction.status === 'resolving'}
        onSubmit={(answers) => resolve(form.toResponse(answers))}
        onCancel={cancelRequest}
      />
    );
  }
  const Component = slot?.component;
  return (
    <PendingInteractionShell title={interaction.payload.title} sourceThread={sourceThread} errorMessage={error}>
      {Component ? (
        <Component
          key={`${interaction.id}:${slot.generation}`}
          interaction={view}
          submit={(value) => run(() => resolve(value))}
          cancel={cancel}
        />
      ) : (
        <>
          <p className="thread-pending-banner-reason">Plugin form is not registered.</p>
          <button type="button" disabled={busy} onClick={() => { void cancel(); }}>Cancel</button>
        </>
      )}
    </PendingInteractionShell>
  );
}

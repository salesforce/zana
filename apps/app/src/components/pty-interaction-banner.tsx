import { useEffect, useState, useSyncExternalStore } from 'react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { apiJson } from '../lib/fetch-with-app-surface.js';
import { subscribeProductEvent, subscribeProductReconnect } from '../lib/product-ws.js';
import { listPendingInteractionSlots, subscribePluginSlots } from '../plugins/plugin-slots.js';
import { PendingInteractionShell } from './thread/pending-interactions/PendingInteractionShell.js';
import { QuestionInteractionBanner } from './thread/pending-interactions/QuestionInteractionBanner.js';

/** A plugin's open request on a PTY session, as the product server lists it. */
export interface PtySessionInteraction {
  id: string;
  sessionId: string;
  projectId: string;
  status: 'pending';
  origin: { kind: 'plugin'; pluginId: string; rendererId: string };
  payload: { kind: 'plugin'; title: string; data: JsonValue; requireHuman: boolean };
  createdAt: number;
  expiresAt: number;
}

const base = (sessionId: string) => `/pty-sessions/${encodeURIComponent(sessionId)}/interactions`;

/** The session's open plugin requests, re-read whenever the server says they changed. */
export function usePtySessionInteractions(sessionId: string | null): PtySessionInteraction[] {
  const [items, setItems] = useState<PtySessionInteraction[]>([]);
  useEffect(() => {
    setItems([]);
    if (!sessionId) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await apiJson<PtySessionInteraction[]>(base(sessionId));
        if (!cancelled) setItems(Array.isArray(next) ? next : []);
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    void load();
    const stopReconnect = subscribeProductReconnect(load);
    const stopChanged = subscribeProductEvent<{ sessionId?: string }>('pty-interactions:changed', (payload) => {
      if (payload?.sessionId === sessionId) void load();
    });
    return () => {
      cancelled = true;
      stopChanged();
      stopReconnect();
    };
  }, [sessionId]);
  return items;
}

/**
 * Presents a plugin's `ui.requestInput` for a PTY session. A desktop answer goes
 * through Electron main, which signs the human-actor proof; the page itself can
 * only ever answer as an unproven caller, so a human-required request stays
 * refused outside the desktop app.
 */
export function PtyInteractionBanner({ sessionId }: { sessionId: string }) {
  const items = usePtySessionInteractions(sessionId);
  const interaction = items[0];
  if (!interaction) return null;
  return <PtyInteractionCard key={interaction.id} interaction={interaction} />;
}

function PtyInteractionCard({ interaction }: { interaction: PtySessionInteraction }) {
  const slots = useSyncExternalStore(subscribePluginSlots, listPendingInteractionSlots, listPendingInteractionSlots);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slot = slots.find((entry) => entry.pluginId === interaction.origin.pluginId && entry.id === interaction.origin.rendererId);
  const { sessionId } = interaction;

  const resolve = async (value: JsonValue) => {
    const respondSession = window.cc?.threads?.interactions?.respondSession;
    if (respondSession) await respondSession(sessionId, interaction.id, value);
    else {
      await apiJson(`${base(sessionId)}/${encodeURIComponent(interaction.id)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ value })
      });
    }
  };
  const cancelRequest = async () => {
    await apiJson(`${base(sessionId)}/${encodeURIComponent(interaction.id)}/cancel`, { method: 'POST' });
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
      /* the error is shown on the card */
    } finally {
      setBusy(false);
    }
  };

  const view = {
    id: interaction.id,
    threadId: sessionId,
    title: interaction.payload.title,
    payload: interaction.payload.data,
    createdAt: interaction.createdAt,
    expiresAt: interaction.expiresAt
  };
  if (slot?.questionForm) {
    const form = slot.questionForm(view);
    return (
      <div data-testid="pty-interaction-banner">
        <QuestionInteractionBanner
          key={`${interaction.id}:${slot.generation}`}
          interactionId={interaction.id}
          questions={form.questions}
          threadId={sessionId}
          resolving={false}
          onSubmit={(answers) => resolve(form.toResponse(answers))}
          onCancel={cancelRequest}
        />
      </div>
    );
  }
  const Component = slot?.component;
  return (
    <div data-testid="pty-interaction-banner">
      <PendingInteractionShell title={interaction.payload.title} errorMessage={error}>
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
    </div>
  );
}

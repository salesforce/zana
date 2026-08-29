import { useEffect, useState } from 'react';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import { product } from '../../../lib/product-client.js';

export function isOpenThreadUpdate(payload: unknown, threadId: string): boolean {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'id' in payload
    && (payload as { id: string }).id === threadId
  );
}

export function isOpenThreadEvent(payload: unknown, threadId: string): boolean {
  return Boolean(
    payload
    && typeof payload === 'object'
    && 'threadId' in payload
    && (payload as { threadId: string }).threadId === threadId
  );
}

export function useOpenPendingInteractions(threadId: string | null): PendingInteraction[] {
  const [items, setItems] = useState<PendingInteraction[]>([]);
  useEffect(() => {
    if (!threadId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const next = await product.threads.interactions.list(threadId);
        if (!cancelled) setItems(Array.isArray(next) ? next : []);
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    void load();
    const stopUpdated = product.threads.onUpdated((payload) => {
      if (isOpenThreadUpdate(payload, threadId)) void load();
    });
    const stopEvents = product.threads.onEvent((payload) => {
      if (isOpenThreadEvent(payload, threadId)) void load();
    });
    return () => {
      cancelled = true;
      stopUpdated();
      stopEvents();
    };
  }, [threadId]);
  return items;
}

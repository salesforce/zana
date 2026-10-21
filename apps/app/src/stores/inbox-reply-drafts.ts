import { create } from 'zustand';
import { formatReplyQuote } from '../lib/inbox-reply-quote.js';

/** Retention cap: the least recently written draft is dropped past this. */
export const MAX_REPLY_DRAFTS = 50;

interface InboxReplyDraftsState {
  drafts: Record<string, string>;
  /** Entry ids, least recently written first. */
  order: string[];
  /** The latest compose request only, so nothing accumulates per entry (retention cap, rule 5). */
  composeRequest: { entryId: string; seq: number } | null;
  setDraft: (entryId: string, text: string) => void;
  clearDraft: (entryId: string) => void;
  requestCompose: (entryId: string) => void;
  appendQuote: (entryId: string, selection: string) => void;
}

/** Selector: the compose sequence for one entry, 0 while the latest request targets another entry. */
export const composeSeqFor = (entryId: string) => (s: { composeRequest: { entryId: string; seq: number } | null }) =>
  s.composeRequest?.entryId === entryId ? s.composeRequest.seq : 0;

export const useInboxReplyDrafts = create<InboxReplyDraftsState>()((set, get) => ({
  drafts: {},
  order: [],
  composeRequest: null,
  setDraft: (entryId, text) =>
    set((s) => {
      const order = s.order.filter((id) => id !== entryId);
      const drafts = { ...s.drafts };
      if (text.trim() === '') {
        delete drafts[entryId];
        return { drafts, order };
      }
      drafts[entryId] = text;
      order.push(entryId);
      while (order.length > MAX_REPLY_DRAFTS) {
        const oldest = order.shift() as string;
        delete drafts[oldest];
      }
      return { drafts, order };
    }),
  clearDraft: (entryId) =>
    set((s) => {
      if (!(entryId in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[entryId];
      return { drafts, order: s.order.filter((id) => id !== entryId) };
    }),
  requestCompose: (entryId) =>
    set((s) => ({ composeRequest: { entryId, seq: (s.composeRequest?.seq ?? 0) + 1 } })),
  appendQuote: (entryId, selection) => {
    const current = get().drafts[entryId] ?? '';
    const next = formatReplyQuote(current, selection);
    if (next !== current) get().setDraft(entryId, next);
    get().requestCompose(entryId);
  },
}));

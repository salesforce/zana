import type { InboxQuestion } from '@zana-ai/zcc-domain/product';

/**
 * Pure answer-building helpers for structured inbox questions, shared by the
 * in-app `QuestionBlock` and the Command Center companion (which must not
 * import the heavy app store).
 */

/** Per-question answer state, one entry per question in the card. */
export interface QState {
  /** Selected option ids (a Set even in radio mode, holding 0 or 1). */
  selected: Set<string>;
  otherText: string;
  otherActive: boolean;
}

export const emptyQState = (): QState => ({ selected: new Set(), otherText: '', otherActive: false });

/**
 * Build one question's answer string from its state. Radio joins to one label;
 * multi joins with commas. The Other text is appended when active + non-empty
 * (and is the whole answer in radio mode).
 */
export function answerFor(question: InboxQuestion, st: QState): string {
  const multi = question.multiSelect === true;
  const chosen = question.options.filter((o) => st.selected.has(o.id)).map((o) => o.label);
  const other = st.otherActive && st.otherText.trim() ? st.otherText.trim() : '';
  if (multi) {
    const parts = [...chosen];
    if (other) parts.push(other);
    return parts.join(', ');
  }
  if (st.otherActive && other) return other;
  return chosen[0] ?? '';
}

/**
 * What actually gets injected. One question → its raw answer. Many → a labelled
 * "Q: …\nA: …" block per question so the agent can tell the answers apart.
 */
export function buildReply(questions: InboxQuestion[], answers: string[]): string {
  if (questions.length <= 1) return answers[0] ?? '';
  return questions.map((q, i) => `Q${i + 1}: ${q.prompt ?? ''}\nA: ${answers[i] ?? ''}`).join('\n\n');
}

/** "Ship it (Recommended)" → { label: "Ship it", recommended: true }. */
export function splitRecommended(label: string): { label: string; recommended: boolean } {
  const m = /^(.*?)\s*[([]\s*recommended\s*[)\]]\s*$/i.exec(label);
  if (m && m[1]) return { label: m[1], recommended: true };
  return { label, recommended: false };
}

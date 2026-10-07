import type { PendingInteractionUserQuestionQuestion } from '@zana-ai/zcc-domain/thread-runtime';
import { createInitialQuestionAnswers, type QuestionAnswerDraft } from './pending-interaction-question-form.js';

const STORAGE_KEY = 'zcc:question-drafts:v1';
const MAX_DRAFTS = 40;
const MAX_BYTES = 256_000;
const memory = new Map<string, QuestionDraft>();
let hydrated = false;
export interface QuestionDraft {
  signature: string;
  index: number;
  answers: Record<string, QuestionAnswerDraft>;
}

function readStore(): Map<string, QuestionDraft> {
  if (hydrated) return memory;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length <= MAX_BYTES) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed.slice(-MAX_DRAFTS)) {
          if (Array.isArray(item) && typeof item[0] === 'string' && item[1] && typeof item[1] === 'object') {
            memory.set(item[0], item[1] as QuestionDraft);
          }
        }
      }
    }
  } catch { /* navigation still retains drafts when storage is unavailable */ }
  return memory;
}

function persist() {
  while (memory.size > MAX_DRAFTS) memory.delete(memory.keys().next().value!);
  try {
    let raw = JSON.stringify([...memory]);
    while (raw.length > MAX_BYTES && memory.size > 0) {
      memory.delete(memory.keys().next().value!);
      raw = JSON.stringify([...memory]);
    }
    localStorage.setItem(STORAGE_KEY, raw);
  } catch { /* best effort; memory is the fallback */ }
}

export function questionDraftKey(threadId: string, interactionId: string): string {
  return JSON.stringify([threadId, interactionId]);
}

export function loadQuestionDraft(key: string, questions: readonly PendingInteractionUserQuestionQuestion[]): QuestionDraft {
  const signature = JSON.stringify(questions);
  const empty = { signature, index: 0, answers: createInitialQuestionAnswers(questions) };
  const saved = readStore().get(key);
  if (!saved || saved.signature !== signature || !Number.isInteger(saved.index) || !saved.answers || typeof saved.answers !== 'object') return empty;
  const answers = empty.answers;
  for (const question of questions) {
    const answer = saved.answers[question.id];
    if (!answer || !Array.isArray(answer.selected) || typeof answer.otherSelected !== 'boolean') return empty;
    const allowed = new Set(question.options?.map(option => option.value));
    if (answer.selected.some(value => typeof value !== 'string' || !allowed.has(value)) ||
        (answer.freeText !== undefined && (typeof answer.freeText !== 'string' || answer.freeText.length > 32_000))) return empty;
    answers[question.id] = { selected: [...answer.selected], otherSelected: answer.otherSelected, ...(answer.freeText === undefined ? {} : { freeText: answer.freeText }) };
  }
  return { signature, index: Math.max(0, Math.min(saved.index, questions.length - 1)), answers };
}

export function saveQuestionDraft(key: string, draft: QuestionDraft) {
  readStore().delete(key);
  memory.set(key, draft);
  persist();
}

export function clearQuestionDraft(key: string, submitted: QuestionDraft) {
  if (JSON.stringify(readStore().get(key)) !== JSON.stringify(submitted)) return;
  memory.delete(key);
  persist();
}

import type {
  PendingInteractionUserAnswer,
  PendingInteractionUserQuestionQuestion
} from '@zana-ai/zcc-domain/thread-runtime';

export const OTHER_OPTION_LABEL = 'Other…';

export interface QuestionAnswerDraft {
  selected: string[];
  freeText?: string;
  otherSelected: boolean;
}

export function pendingQuestionBannerTitle(count: number): string {
  if (count <= 1) return 'Waiting for an answer';
  return `Waiting for answers to ${count} questions`;
}

export function optionInvitesFreeText(option: { label: string; value: string }): boolean {
  const label = option.label.trim();
  const value = option.value.trim();
  return /^(other|something else|custom)([.…: ]|$)/i.test(label)
    || /^(other|custom)$/i.test(value);
}

export function shouldShowOtherChoice(
  question: Pick<PendingInteractionUserQuestionQuestion, 'allowFreeText' | 'options'>
): boolean {
  if (!question.allowFreeText) return false;
  const options = question.options ?? [];
  return options.length > 0 && !options.some(optionInvitesFreeText);
}

export function shouldShowFreeTextInput(
  question: Pick<PendingInteractionUserQuestionQuestion, 'allowFreeText' | 'options'>,
  answer: QuestionAnswerDraft
): boolean {
  if (!question.allowFreeText) return false;
  const options = question.options ?? [];
  if (options.length === 0) return true;
  if (answer.otherSelected) return true;
  return answer.selected.some((value) => {
    const option = options.find((entry) => entry.value === value);
    return option ? optionInvitesFreeText(option) : false;
  });
}

export function isQuestionAnswered(
  question: Pick<PendingInteractionUserQuestionQuestion, 'allowFreeText' | 'multiSelect' | 'options'>,
  answer: QuestionAnswerDraft
): boolean {
  const hasText = Boolean(answer.freeText?.trim());
  if (shouldShowFreeTextInput(question, answer)) {
    if (question.multiSelect) return answer.selected.length > 0 || hasText;
    return hasText;
  }
  return answer.selected.length > 0;
}

const RECOMMENDED_SUFFIX = /\s*[-–—(]\s*recommended\s*\)?\s*$/i;

/** Splits an agent's "Label (Recommended)" convention into a clean label plus a flag. */
export function splitRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const stripped = label.replace(RECOMMENDED_SUFFIX, '').trim();
  if (stripped === label.trim() || !stripped) return { label, recommended: false };
  return { label: stripped, recommended: true };
}

export function recommendedOptionValue(
  question: Pick<PendingInteractionUserQuestionQuestion, 'multiSelect' | 'options'>
): string | undefined {
  if (question.multiSelect) return undefined;
  const recommended = (question.options ?? []).filter((option) => splitRecommendedLabel(option.label).recommended);
  return recommended.length === 1 ? recommended[0]!.value : undefined;
}

export interface InlineSegment {
  text: string;
  code: boolean;
}

/** Splits `inline code` spans out of prompt/option text; unmatched backticks stay literal. */
export function splitInlineCode(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const pattern = /`([^`\n]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), code: false });
    segments.push({ text: match[1]!, code: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), code: false });
  return segments;
}

/** Maps a digit key to a zero-based choice index, or -1 when it doesn't pick a choice. */
export function questionChoiceIndexForKey(key: string, choiceCount: number): number {
  if (!/^[1-9]$/.test(key)) return -1;
  const index = Number(key) - 1;
  return index < choiceCount ? index : -1;
}

export function createInitialQuestionAnswers(
  questions: readonly (Pick<PendingInteractionUserQuestionQuestion, 'id' | 'allowFreeText'>
    & Partial<Pick<PendingInteractionUserQuestionQuestion, 'multiSelect' | 'options'>>)[]
): Record<string, QuestionAnswerDraft> {
  const initial: Record<string, QuestionAnswerDraft> = {};
  for (const question of questions) {
    const recommended = recommendedOptionValue({ multiSelect: question.multiSelect ?? false, options: question.options });
    initial[question.id] = {
      selected: recommended ? [recommended] : [],
      freeText: question.allowFreeText ? '' : undefined,
      otherSelected: false
    };
  }
  return initial;
}

export function toggleQuestionOption(
  question: Pick<PendingInteractionUserQuestionQuestion, 'multiSelect'>,
  answer: QuestionAnswerDraft,
  optionValue: string
): QuestionAnswerDraft {
  if (question.multiSelect) {
    const selected = answer.selected.includes(optionValue)
      ? answer.selected.filter((value) => value !== optionValue)
      : [...answer.selected, optionValue];
    return { ...answer, selected };
  }
  return { selected: [optionValue], freeText: answer.freeText, otherSelected: false };
}

export function toggleOtherChoice(
  question: Pick<PendingInteractionUserQuestionQuestion, 'multiSelect'>,
  answer: QuestionAnswerDraft
): QuestionAnswerDraft {
  if (question.multiSelect) {
    return { ...answer, otherSelected: !answer.otherSelected };
  }
  return { selected: [], freeText: answer.freeText, otherSelected: true };
}

export function toUserAnswerResolution(
  questions: readonly Pick<PendingInteractionUserQuestionQuestion, 'id' | 'allowFreeText' | 'options'>[],
  answers: Record<string, QuestionAnswerDraft>
): Record<string, PendingInteractionUserAnswer> {
  const resolution: Record<string, PendingInteractionUserAnswer> = {};
  for (const question of questions) {
    const answer = answers[question.id] ?? { selected: [], otherSelected: false };
    const includeText = shouldShowFreeTextInput(question, answer) && Boolean(answer.freeText?.trim());
    resolution[question.id] = {
      selected: answer.selected,
      ...(includeText ? { freeText: answer.freeText!.trim() } : {})
    };
  }
  return resolution;
}

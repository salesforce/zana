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

export function createInitialQuestionAnswers(
  questions: readonly Pick<PendingInteractionUserQuestionQuestion, 'id' | 'allowFreeText'>[]
): Record<string, QuestionAnswerDraft> {
  const initial: Record<string, QuestionAnswerDraft> = {};
  for (const question of questions) {
    initial[question.id] = {
      selected: [],
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

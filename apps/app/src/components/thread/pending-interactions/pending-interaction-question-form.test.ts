import { describe, expect, it } from 'vitest';
import {
  createInitialQuestionAnswers,
  isQuestionAnswered,
  optionInvitesFreeText,
  pendingQuestionBannerTitle,
  questionChoiceIndexForKey,
  recommendedOptionValue,
  shouldShowFreeTextInput,
  shouldShowOtherChoice,
  splitInlineCode,
  splitRecommendedLabel,
  toggleOtherChoice,
  toggleQuestionOption,
  toUserAnswerResolution
} from './pending-interaction-question-form.js';

const optionQuestion = {
  id: 'q1',
  allowFreeText: true,
  multiSelect: false,
  options: [
    { value: 'workspace', label: 'This workspace/codebase' },
    { value: 'else', label: 'Something else' }
  ]
};

describe('pending interaction question form', () => {
  it('titles a single question and a set of questions', () => {
    expect(pendingQuestionBannerTitle(1)).toBe('Waiting for an answer');
    expect(pendingQuestionBannerTitle(2)).toBe('Waiting for answers to 2 questions');
  });

  it('treats Something else / Other as a free-text invitation', () => {
    expect(optionInvitesFreeText({ value: 'else', label: 'Something else' })).toBe(true);
    expect(optionInvitesFreeText({ value: 'other', label: 'Other' })).toBe(true);
    expect(optionInvitesFreeText({ value: 'workspace', label: 'This workspace/codebase' })).toBe(false);
  });

  it('adds Other only when free text is allowed and no option already invites it', () => {
    expect(shouldShowOtherChoice(optionQuestion)).toBe(false);
    expect(shouldShowOtherChoice({
      allowFreeText: true,
      options: [{ value: 'yes', label: 'Yes' }]
    })).toBe(true);
    expect(shouldShowOtherChoice({
      allowFreeText: false,
      options: [{ value: 'yes', label: 'Yes' }]
    })).toBe(false);
    expect(shouldShowOtherChoice({ allowFreeText: true, options: [] })).toBe(false);
  });

  it('shows free text for open questions and invited options, not named choices', () => {
    const empty = { selected: [], otherSelected: false };
    expect(shouldShowFreeTextInput({ allowFreeText: true, options: [] }, empty)).toBe(true);
    expect(shouldShowFreeTextInput(optionQuestion, {
      selected: ['workspace'],
      otherSelected: false
    })).toBe(false);
    expect(shouldShowFreeTextInput(optionQuestion, {
      selected: ['else'],
      otherSelected: false
    })).toBe(true);
    expect(shouldShowFreeTextInput({
      allowFreeText: true,
      options: [{ value: 'yes', label: 'Yes' }]
    }, { selected: [], otherSelected: true })).toBe(true);
  });

  it('treats a named choice as answered and Something else as unanswered until typed', () => {
    expect(isQuestionAnswered(optionQuestion, {
      selected: ['workspace'],
      otherSelected: false
    })).toBe(true);
    expect(isQuestionAnswered(optionQuestion, {
      selected: ['else'],
      otherSelected: false
    })).toBe(false);
    expect(isQuestionAnswered(optionQuestion, {
      selected: ['else'],
      freeText: 'Release notes',
      otherSelected: false
    })).toBe(true);
    expect(isQuestionAnswered({
      allowFreeText: true,
      multiSelect: false,
      options: []
    }, { selected: [], freeText: '  ', otherSelected: false })).toBe(false);
    expect(isQuestionAnswered({
      allowFreeText: true,
      multiSelect: true,
      options: [{ value: 'a', label: 'A' }]
    }, { selected: ['a'], otherSelected: false })).toBe(true);
    expect(isQuestionAnswered({
      allowFreeText: true,
      multiSelect: true,
      options: [{ value: 'a', label: 'A' }]
    }, { selected: [], freeText: 'other', otherSelected: true })).toBe(true);
    expect(toggleOtherChoice({ multiSelect: true }, {
      selected: ['a'],
      otherSelected: false
    }).otherSelected).toBe(true);
  });

  it('toggles single-select, multi-select, and Other without leaking a synthetic value', () => {
    const single = toggleQuestionOption(
      { multiSelect: false },
      { selected: [], otherSelected: true, freeText: 'x' },
      'yes'
    );
    expect(single).toEqual({ selected: ['yes'], otherSelected: false, freeText: 'x' });
    const multi = toggleQuestionOption(
      { multiSelect: true },
      { selected: ['a'], otherSelected: false },
      'b'
    );
    expect(multi.selected).toEqual(['a', 'b']);
    expect(toggleQuestionOption(
      { multiSelect: true },
      { selected: ['a'], otherSelected: false },
      'a'
    ).selected).toEqual([]);
    expect(toggleOtherChoice({ multiSelect: false }, {
      selected: ['yes'],
      otherSelected: false
    })).toEqual({ selected: [], otherSelected: true });
  });

  it('omits hidden free text from the submitted resolution', () => {
    const answers = createInitialQuestionAnswers([optionQuestion]);
    answers.q1 = { selected: ['workspace'], freeText: 'should not send', otherSelected: false };
    expect(toUserAnswerResolution([optionQuestion], answers)).toEqual({
      q1: { selected: ['workspace'] }
    });
    answers.q1 = { selected: ['else'], freeText: '  Release notes  ', otherSelected: false };
    expect(toUserAnswerResolution([optionQuestion], answers)).toEqual({
      q1: { selected: ['else'], freeText: 'Release notes' }
    });
    expect(shouldShowFreeTextInput(optionQuestion, {
      selected: ['missing'],
      otherSelected: false
    })).toBe(false);
    expect(toUserAnswerResolution([optionQuestion], {})).toEqual({
      q1: { selected: [] }
    });
  });

  it('splits the Recommended suffix off an option label', () => {
    expect(splitRecommendedLabel('Use a worktree (Recommended)')).toEqual({ label: 'Use a worktree', recommended: true });
    expect(splitRecommendedLabel('Ship it — recommended')).toEqual({ label: 'Ship it', recommended: true });
    expect(splitRecommendedLabel('Wait')).toEqual({ label: 'Wait', recommended: false });
    expect(splitRecommendedLabel('Recommended')).toEqual({ label: 'Recommended', recommended: false });
  });

  it('preselects a single recommended option for single-select questions only', () => {
    const options = [
      { value: 'tree', label: 'Use a worktree (Recommended)' },
      { value: 'here', label: 'Work here' }
    ];
    expect(recommendedOptionValue({ multiSelect: false, options })).toBe('tree');
    expect(recommendedOptionValue({ multiSelect: true, options })).toBeUndefined();
    expect(recommendedOptionValue({
      multiSelect: false,
      options: options.map((option) => ({ ...option, label: `${option.label} (Recommended)` }))
    })).toBeUndefined();
    expect(createInitialQuestionAnswers([{ id: 'q', allowFreeText: true, multiSelect: false, options }]).q)
      .toEqual({ selected: ['tree'], freeText: '', otherSelected: false });
    expect(createInitialQuestionAnswers([{ id: 'q', allowFreeText: false }]).q)
      .toEqual({ selected: [], freeText: undefined, otherSelected: false });
  });

  it('splits inline code spans and leaves unmatched backticks literal', () => {
    expect(splitInlineCode('Edit `a.ts` and `b.ts` now')).toEqual([
      { text: 'Edit ', code: false },
      { text: 'a.ts', code: true },
      { text: ' and ', code: false },
      { text: 'b.ts', code: true },
      { text: ' now', code: false }
    ]);
    expect(splitInlineCode('`main`')).toEqual([{ text: 'main', code: true }]);
    expect(splitInlineCode('a ` lone tick')).toEqual([{ text: 'a ` lone tick', code: false }]);
  });

  it('maps digit keys to choices within range', () => {
    expect(questionChoiceIndexForKey('1', 3)).toBe(0);
    expect(questionChoiceIndexForKey('3', 3)).toBe(2);
    expect(questionChoiceIndexForKey('4', 3)).toBe(-1);
    expect(questionChoiceIndexForKey('0', 3)).toBe(-1);
    expect(questionChoiceIndexForKey('a', 3)).toBe(-1);
  });
});

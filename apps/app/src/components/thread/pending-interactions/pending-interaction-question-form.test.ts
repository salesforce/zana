import { describe, expect, it } from 'vitest';
import {
  createInitialQuestionAnswers,
  isQuestionAnswered,
  optionInvitesFreeText,
  pendingQuestionBannerTitle,
  shouldShowFreeTextInput,
  shouldShowOtherChoice,
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
});


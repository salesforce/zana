import { describe, expect, it } from 'vitest';
import app, { questionForm } from '../app.js';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';

describe('host question form adapter', () => {
  it('registers a host-rendered form and maps normalized questions without losing metadata', () => {
    const slot = collectTestPluginApp(app, 'ask-user-question').pendingInteractions[0]!;
    expect(slot.component).toBeUndefined();
    expect(slot.questionForm).toBe(questionForm);
    const form = questionForm({ payload: { questions: [
      { header: 'Color', question: 'Pick colors', multiSelect: true, options: [
        { label: 'Red', description: 'warm' }, { label: 'Blue', description: 'cool' }
      ] },
      { question: 'Pick a size', options: [{ label: 'M' }] }
    ] } });
    expect(form.questions).toEqual([
      { id: 'question-0', shortLabel: 'Color', prompt: 'Pick colors', multiSelect: true, allowFreeText: true,
        options: [{ value: 'Red', label: 'Red', description: 'warm' }, { value: 'Blue', label: 'Blue', description: 'cool' }] },
      { id: 'question-1', prompt: 'Pick a size', multiSelect: false, allowFreeText: true,
        options: [{ value: 'M', label: 'M' }] }
    ]);
    expect(form.toResponse({ 'question-0': { selected: ['Red', 'Blue'] }, 'question-1': { selected: [], freeText: 'Custom size' } })).toEqual({ answers: [
      { question: 'Pick colors', selected: ['Red', 'Blue'], freeText: '' },
      { question: 'Pick a size', selected: [], freeText: 'Custom size' }
    ] });
    expect(form.toResponse({}).answers[0]).toEqual({ question: 'Pick colors', selected: [], freeText: '' });
  });
});

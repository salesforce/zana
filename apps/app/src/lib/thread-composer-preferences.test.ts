import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { findActiveTrigger } from '../components/composer/find-active-trigger.js';
import { COMPOSER_TRIGGERS } from '../components/composer/types.js';
import { composerPromptExtensions, resolveThreadSendMode, resolvedComposerSendMode } from './thread-composer-preferences.js';

describe('resolveThreadSendMode', () => {
  it('maps absent composerSendMode from the legacy steer boolean without flipping false', () => {
    expect(resolvedComposerSendMode({})).toBe('auto');
    expect(resolvedComposerSendMode({ steerActiveThreadOnEnter: false })).toBe('auto');
    expect(resolvedComposerSendMode({ steerActiveThreadOnEnter: true })).toBe('steer');
    expect(resolvedComposerSendMode({
      composerSendMode: 'queue-if-active',
      steerActiveThreadOnEnter: true
    })).toBe('queue-if-active');
  });

  it('uses auto unless the picker is Steer/Queue and the thread is running', () => {
    expect(resolveThreadSendMode({
      pickerMode: 'auto',
      threadRunning: true,
      modifierEnter: false
    })).toBe('auto');
    expect(resolveThreadSendMode({
      pickerMode: 'steer',
      threadRunning: false,
      modifierEnter: false
    })).toBe('auto');
  });

  it('inverts Steer to Queue only on modifier+Enter', () => {
    expect(resolveThreadSendMode({
      pickerMode: 'steer',
      threadRunning: true,
      modifierEnter: false
    })).toBe('steer');
    expect(resolveThreadSendMode({
      pickerMode: 'steer',
      threadRunning: true,
      modifierEnter: true
    })).toBe('queue-if-active');
    expect(resolveThreadSendMode({
      pickerMode: 'queue-if-active',
      threadRunning: true,
      modifierEnter: true
    })).toBe('queue-if-active');
  });
});

describe('composerPromptExtensions slash trigger', () => {
  function editorWithMarkdown(markdownEnabled: boolean) {
    return new Editor({
      extensions: composerPromptExtensions(markdownEnabled, 'Ask anything'),
      content: { type: 'doc', content: [{ type: 'paragraph' }] }
    });
  }

  it('detects a slash command trigger when markdown is enabled', () => {
    const editor = editorWithMarkdown(true);
    editor.view.dispatch(editor.state.tr.insertText('/'));
    const text = editor.state.doc.textBetween(0, editor.state.selection.from, '\n', '\n');
    const trigger = findActiveTrigger(editor, COMPOSER_TRIGGERS);
    const json = editor.getJSON();
    editor.destroy();
    expect({ text, trigger, json }).toEqual({
      text: '/',
      trigger: { char: '/', kind: 'command', query: '', from: 1, to: 2 },
      json: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '/' }] }]
      }
    });
  });

  it('detects a slash command trigger when markdown is disabled', () => {
    const editor = editorWithMarkdown(false);
    editor.view.dispatch(editor.state.tr.insertText('/'));
    const trigger = findActiveTrigger(editor, COMPOSER_TRIGGERS);
    editor.destroy();
    expect(trigger).toMatchObject({ char: '/', kind: 'command', query: '' });
  });

  it('keeps /plan as plain text instead of an autolink', () => {
    const editor = editorWithMarkdown(true);
    editor.view.dispatch(editor.state.tr.insertText('/plan'));
    const json = editor.getJSON();
    const trigger = findActiveTrigger(editor, COMPOSER_TRIGGERS);
    editor.destroy();
    expect(trigger).toMatchObject({ char: '/', kind: 'command', query: 'plan' });
    expect(json).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '/plan' }] }]
    });
  });
});

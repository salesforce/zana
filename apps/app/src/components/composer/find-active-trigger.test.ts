import { describe, expect, it } from 'vitest';
import { findActiveTrigger } from './find-active-trigger.js';
import { COMPOSER_TRIGGERS } from './types.js';

function editorWithText(
  text: string,
  options: { caret?: number; empty?: boolean } = {}
): Parameters<typeof findActiveTrigger>[0] {
  const caret = options.caret ?? text.length;
  return {
    state: {
      selection: {
        empty: options.empty ?? true,
        from: caret
      },
      doc: {
        textBetween(from: number, to: number) {
          return text.slice(from, to);
        }
      }
    }
  };
}

describe('findActiveTrigger', () => {
  it('detects a slash command trigger with a skill query', () => {
    expect(
      findActiveTrigger(editorWithText('Run /openai-docs'), COMPOSER_TRIGGERS)
    ).toEqual({
      char: '/',
      kind: 'command',
      query: 'openai-docs',
      from: 4,
      to: 'Run /openai-docs'.length
    });
  });

  it('captures namespaced slash command queries', () => {
    expect(
      findActiveTrigger(editorWithText('/frontend:component'), COMPOSER_TRIGGERS)
    ).toMatchObject({
      char: '/',
      kind: 'command',
      query: 'frontend:component'
    });
  });

  it('detects an @ mention at the start of input', () => {
    expect(
      findActiveTrigger(editorWithText('@src/fo'), COMPOSER_TRIGGERS)
    ).toEqual({
      char: '@',
      kind: 'mention',
      query: 'src/fo',
      from: 0,
      to: '@src/fo'.length
    });
  });

  it('detects an @ mention after whitespace', () => {
    expect(
      findActiveTrigger(editorWithText('open @main'), COMPOSER_TRIGGERS)
    ).toEqual({
      char: '@',
      kind: 'mention',
      query: 'main',
      from: 5,
      to: 'open @main'.length
    });
  });

  it('does not treat email-like mid-word @ as a mention', () => {
    expect(
      findActiveTrigger(editorWithText('me@host'), COMPOSER_TRIGGERS)
    ).toBeNull();
  });

  it('does not treat a/b as a command trigger', () => {
    expect(
      findActiveTrigger(editorWithText('src/lib'), COMPOSER_TRIGGERS)
    ).toBeNull();
  });

  it('returns null for a non-empty selection', () => {
    expect(
      findActiveTrigger(editorWithText('@src', { empty: false }), COMPOSER_TRIGGERS)
    ).toBeNull();
  });

  it('does not extend a mention query through a repeated trigger char', () => {
    expect(
      findActiveTrigger(editorWithText('Look at @one@two'), COMPOSER_TRIGGERS)
    ).toBeNull();
  });

  it('keeps spaces verbatim in a multiword mention query', () => {
    const query = 'Hello world ';
    const text = `Ask @${query}`;
    expect(findActiveTrigger(editorWithText(text), COMPOSER_TRIGGERS)).toEqual({
      char: '@',
      kind: 'mention',
      query,
      from: 'Ask '.length,
      to: text.length
    });
  });

  it('still ends a mention query on a tab or newline', () => {
    expect(findActiveTrigger(editorWithText('Ask @prompt\t'), COMPOSER_TRIGGERS)).toBeNull();
    expect(findActiveTrigger(editorWithText('Ask @prompt\n'), COMPOSER_TRIGGERS)).toBeNull();
  });
});

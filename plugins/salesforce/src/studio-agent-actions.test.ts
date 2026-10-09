import { describe, expect, it } from 'vitest';
import { buildStudioPrompt, formatComments, formatDiagnostics, MAX_STUDIO_PROMPT_LENGTH, roleForAction, STUDIO_AGENT_ACTIONS, studioActionById } from '../lib/studio-agent-actions.js';
import type { StudioComment, StudioDiagnostic } from '../lib/studio-contract.js';

const diag = (n: number): StudioDiagnostic => ({ line: n, column: 1, endLine: n, endColumn: 4, severity: 'error', message: `bad thing ${n}\nsecond line`, code: 'E1' });
const comment: StudioComment = { id: 'c1', path: 'a.agent', line: 3, endLine: 5, quote: 'quote', body: 'fix it', author: { kind: 'user', name: 'me' }, createdAt: 1 };

describe('studio agent actions', () => {
  it('defines the seven actions with unique ids', () => {
    expect(STUDIO_AGENT_ACTIONS.map(a => a.id)).toEqual(['review', 'fix-problems', 'address-comments', 'write-scenarios', 'explain-selection', 'generate-action', 'harden-guardrails']);
    expect(studioActionById('review')?.role).toBe('reviewer');
    expect(studioActionById('nope')).toBeNull();
    expect(roleForAction('write-scenarios')).toBe('tester');
    expect(roleForAction('fix-problems')).toBe('editor');
    expect(roleForAction(undefined)).toBe('assistant');
    expect(roleForAction('unknown')).toBe('assistant');
  });

  it('formats diagnostics and comments on single lines', () => {
    expect(formatDiagnostics([diag(2)])).toEqual(['- error L2:1 [E1] bad thing 2 second line']);
    expect(formatDiagnostics(Array.from({ length: 30 }, (_, i) => diag(i + 1)))).toHaveLength(20);
    expect(formatComments([comment])[0]).toBe('- c1 L3-5 "quote": fix it');
    expect(formatComments([{ ...comment, endLine: 3 }])[0]).toContain('L3 ');
  });

  it('builds a prompt that ends with the directive and includes context', () => {
    const prompt = buildStudioPrompt({
      path: 'force-app/Help.agent', action: studioActionById('fix-problems'), prompt: ' also check x ',
      view: { dirty: true, tool: 'code', selection: { startLine: 2, endLine: 4, text: 'topic a' } },
      diagnostics: [diag(2)], comments: [comment]
    });
    expect(prompt).toContain('"force-app/Help.agent"');
    expect(prompt).toContain('also check x');
    expect(prompt).toContain('unsaved edits');
    expect(prompt).toContain('Selected lines 2-4');
    expect(prompt).toContain('Problems:');
    expect(prompt).toContain('Open comments:');
    expect(prompt.trimEnd().endsWith('on its own line.')).toBe(true);
    expect(prompt).toContain('::sf-agent{path="force-app/Help.agent"}');
  });

  it('uses the cursor when nothing is selected and works without a view', () => {
    expect(buildStudioPrompt({ path: 'a.agent', prompt: 'hi', view: { dirty: false, tool: null, cursor: { line: 9, column: 1 } } })).toContain('Cursor at line 9.');
    expect(buildStudioPrompt({ path: 'a.agent', prompt: 'hi' })).toContain('hi');
  });

  it('stays within 4000 chars and keeps the closing instruction', () => {
    const prompt = buildStudioPrompt({
      path: 'a.agent', action: studioActionById('review'), prompt: 'x'.repeat(5000),
      diagnostics: Array.from({ length: 50 }, (_, i) => diag(i + 1)),
      comments: Array.from({ length: 50 }, (_, i) => ({ ...comment, id: `c${i}`, body: 'b'.repeat(500) })),
      view: { dirty: true, tool: null, selection: { startLine: 1, endLine: 2, text: 's'.repeat(2000) } }
    });
    expect(prompt.length).toBeLessThanOrEqual(MAX_STUDIO_PROMPT_LENGTH);
    expect(prompt).toContain('::sf-agent{path="a.agent"}');
  });

  it('strips characters that could break the directive from the path', () => {
    expect(buildStudioPrompt({ path: 'a"b\n.agent', prompt: 'x' })).toContain('::sf-agent{path="ab.agent"}');
  });
});

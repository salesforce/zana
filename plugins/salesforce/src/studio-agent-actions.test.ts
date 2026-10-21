import { describe, expect, it } from 'vitest';
import { buildStudioContext, buildStudioRequest, formatComments, formatDiagnostics, MAX_STUDIO_PROMPT_LENGTH, roleForAction, STUDIO_AGENT_ACTIONS, studioActionById } from '../lib/studio-agent-actions.js';
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

  it('sends a short request: the user\'s own words, else the action\'s ask', () => {
    const selection = { dirty: false, tool: null, selection: { startLine: 3, endLine: 5, text: 't' } };
    expect(buildStudioRequest({ path: 'force-app/x/Help.agent', action: studioActionById('explain-selection'), view: selection })).toBe('Explain lines 3-5 of Help.agent.');
    expect(buildStudioRequest({ path: 'Help.agent', action: studioActionById('explain-selection'), view: { ...selection, selection: { startLine: 3, endLine: 3, text: 't' } } })).toBe('Explain line 3 of Help.agent.');
    expect(buildStudioRequest({ path: 'Help.agent', action: studioActionById('explain-selection'), view: { dirty: false, tool: null, cursor: { line: 9, column: 1 } } })).toBe('Explain line 9 of Help.agent.');
    expect(buildStudioRequest({ path: 'Help.agent', action: studioActionById('explain-selection') })).toBe('Explain the selected lines of Help.agent.');
    expect(buildStudioRequest({ path: 'Help.agent', action: studioActionById('fix-problems'), prompt: ' also check x ' })).toBe('also check x');
    expect(buildStudioRequest({ path: 'Help.agent', prompt: 'x'.repeat(5000) })).toHaveLength(1500);
    expect(buildStudioRequest({ path: 'Help.agent' })).toBe('Help me with Help.agent.');
    for (const action of STUDIO_AGENT_ACTIONS) {
      const ask = buildStudioRequest({ path: 'a/Help.agent', action, view: selection });
      expect(ask).toContain('Help.agent');
      expect(ask.length).toBeLessThan(60);
    }
  });

  it('builds the context the agent gets: file, action, view, problems, comments, closing directive', () => {
    const context = buildStudioContext({
      path: 'force-app/Help.agent', action: studioActionById('fix-problems'),
      view: { dirty: true, tool: 'code', selection: { startLine: 2, endLine: 4, text: 'topic a' } },
      diagnostics: [diag(2), diag(30)], comments: [comment]
    });
    expect(context).toContain('"force-app/Help.agent"');
    expect(context).toContain('"Fix problems" action. For that request: Fix the compiler/lint problems');
    expect(context).toContain('unsaved edits');
    expect(context).toContain('Selected lines 2-4');
    // Fixing problems needs all of them, not only those on the selection.
    expect(context).toContain('Problems:\n- error L2:1');
    expect(context).toContain('L30:1');
    expect(context).toContain('Open comments:');
    expect(context.trimEnd().endsWith('on its own line.')).toBe(true);
    expect(context).toContain('::sf-agent{path="force-app/Help.agent"}');
  });

  it('keeps only the problems on the lines being explained', () => {
    const explain = (view: any) => buildStudioContext({ path: 'a.agent', action: studioActionById('explain-selection'), view, diagnostics: [diag(2), { ...diag(9), endLine: 12 }, diag(30)] });
    const picked = explain({ dirty: false, tool: null, selection: { startLine: 3, endLine: 10, text: 't' } });
    expect(picked).toContain('Problems on those lines:\n- error L9:1');
    expect(picked).not.toContain('L2:1');
    expect(picked).not.toContain('L30:1');
    expect(explain({ dirty: false, tool: null, selection: { startLine: 20, endLine: 21, text: 't' } })).not.toContain('Problems');
    // Without a selection there is nothing to narrow to.
    expect(explain({ dirty: false, tool: null, cursor: { line: 9, column: 1 } })).toContain('Cursor at line 9.\n\nProblems:');
  });

  it('works without a view or action', () => {
    const context = buildStudioContext({ path: 'a.agent' });
    expect(context).not.toContain('action');
    expect(context).toContain('::sf-agent{path="a.agent"}');
  });

  it('stays within 4000 chars and keeps the closing instruction', () => {
    const context = buildStudioContext({
      path: 'a.agent', action: studioActionById('review'),
      diagnostics: Array.from({ length: 50 }, (_, i) => diag(i + 1)),
      comments: Array.from({ length: 50 }, (_, i) => ({ ...comment, id: `c${i}`, body: 'b'.repeat(500) })),
      view: { dirty: true, tool: null, selection: { startLine: 1, endLine: 2, text: 's'.repeat(2000) } }
    });
    expect(context.length).toBeLessThanOrEqual(MAX_STUDIO_PROMPT_LENGTH);
    expect(context).toContain('::sf-agent{path="a.agent"}');
  });

  it('strips characters that could break the directive from the path', () => {
    expect(buildStudioContext({ path: 'a"b\n.agent' })).toContain('::sf-agent{path="ab.agent"}');
  });
});

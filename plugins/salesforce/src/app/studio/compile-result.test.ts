import { describe, expect, it } from 'vitest';
import { compilerDiagnostic, parseCompileReply } from './compile-result.js';

describe('compile result', () => {
  it('places a compiler failure at the first position it names', () => {
    expect(compilerDiagnostic('Bot.agent:12:4 bad')).toMatchObject({ line: 12, column: 4, endLine: 12, endColumn: 5, severity: 'error', code: 'compiler', message: 'Bot.agent:12:4 bad' });
    expect(compilerDiagnostic('Bot.agent:7 bad')).toMatchObject({ line: 7, column: 1 });
    expect(compilerDiagnostic('Error at line 9, column 3: x')).toMatchObject({ line: 9, column: 3 });
    expect(compilerDiagnostic('Error on Line 2 col 8')).toMatchObject({ line: 2, column: 8 });
    expect(compilerDiagnostic('line 0')).toMatchObject({ line: 1, column: 1 });
    expect(compilerDiagnostic('no position')).toMatchObject({ line: 1, column: 1 });
    expect(compilerDiagnostic('   ').message).toBe('The compiler failed.');
    const long = compilerDiagnostic('x'.repeat(5000)).message;
    expect(long).toHaveLength(2000);
    expect(long.endsWith('…')).toBe(true);
  });

  it('reads a compile reply and names anything unexpected as a failure', () => {
    expect(parseCompileReply('a.agent', 's1', { ok: true, summary: 'Compiled A (cli)' })).toEqual({ status: 'passed', path: 'a.agent', sha: 's1', summary: 'Compiled A (cli)' });
    expect(parseCompileReply('a.agent', undefined, { ok: true })).toEqual({ status: 'passed', path: 'a.agent', summary: 'Compiled' });
    expect(parseCompileReply('a.agent', 's1', { ok: false, code: 'refused', error: 'Operator denied compile.' })).toEqual({ status: 'failed', path: 'a.agent', sha: 's1', code: 'refused', message: 'Operator denied compile.' });
    expect(parseCompileReply('a.agent', undefined, 'nope')).toEqual({ status: 'failed', path: 'a.agent', code: 'failed', message: 'The compiler did not answer.' });
    expect(parseCompileReply('a.agent', undefined, { ok: false, code: '', error: '' })).toMatchObject({ code: 'failed', message: 'The compiler did not answer.' });
  });
});

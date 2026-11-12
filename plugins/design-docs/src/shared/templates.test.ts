import { describe, expect, it } from 'vitest';
import { renderTemplateFiles, templateById } from './templates.js';
import { PLAN_MD_CONTENT, RESEARCH_AGENTS_CONTENT, ISSUE_AGENTS_CONTENT, PRODUCT_AGENTS_CONTENT } from './template-docs.js';
import { parsePortablePlan } from '../../../../apps/server/src/services/execution/portable-plan.js';

describe('templates helpers', () => {
  it('ships parser-compatible executable examples without invented completion checks', () => {
    expect(PLAN_MD_CONTENT).not.toContain('**Completion criteria:**');
    expect(PLAN_MD_CONTENT).not.toContain('Stop conditions');
    expect(PLAN_MD_CONTENT.match(/\*\*On failure:\*\* fail run/g)).toHaveLength(2);
    expect(PLAN_MD_CONTENT).toContain('### step-id: Step Title <!-- executable-step -->');
    expect(PLAN_MD_CONTENT).toContain('### test-only-example: Test-Only Example <!-- executable-step -->');
    const parsed = parsePortablePlan(PLAN_MD_CONTENT);
    expect(parsed).toMatchObject({ ok: true, units: [{ id: 'step-id', onFailure: { kind: 'fail-run' } }, { id: 'test-only-example', onFailure: { kind: 'fail-run' } }] });
    if (parsed.ok) expect(parsed.units.every((unit) => !unit.checks?.length)).toBe(true);
  });

  it.each([RESEARCH_AGENTS_CONTENT, ISSUE_AGENTS_CONTENT, PRODUCT_AGENTS_CONTENT])('teaches deterministic completion grammar in plan instructions', (content) => {
    expect(content).not.toContain('Stop conditions');
    expect(content).not.toContain('Verification, Completion criteria,');
    expect(content).toContain('Verification, On failure, Outputs / handoff');
    expect(content).toContain('Completion criteria: check:<name>');
    expect(content).toContain('registered names');
    expect(content).toContain('otherwise omit the Completion criteria label');
    expect(content).toContain('On failure: fail run');
    expect(content).toContain('[A-Za-z_][A-Za-z0-9_-]*');
    expect(content).toContain('100 characters');
  });

  it('looks up built-ins by id and returns null for unknown ids', () => {
    expect(templateById('technical')?.id).toBe('technical');
    expect(templateById('nope')).toBeNull();
    expect(templateById(undefined)).toBeNull();
  });

  it('fills placeholders, escapes HTML pages, falls back to a default summary and keeps base64 files', () => {
    const rendered = renderTemplateFiles({
      id: 't', label: 'T', description: '', files: [
        { path: 'README.md', content: '# {{title}}\n{{summary}}' },
        { path: 'index.html', content: '<h1>{{title}}</h1>' },
        { path: 'pic.png', content: 'AAEC', encoding: 'base64' }
      ]
    }, { title: '<A&B>', summary: '  ' });
    expect(rendered[0]!.content).toBe('# <A&B>\nOne-paragraph summary of the proposal.');
    expect(rendered[1]!.content).toBe('<h1>&#60;A&#38;B&#62;</h1>');
    expect(rendered[2]).toEqual({ path: 'pic.png', content: 'AAEC', encoding: 'base64' });
  });
});

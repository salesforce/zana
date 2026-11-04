import { describe, expect, it } from 'vitest';
import { renderTemplateFiles, templateById } from './templates.js';

describe('templates helpers', () => {
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

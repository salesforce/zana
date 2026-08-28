import { describe, expect, it } from 'vitest';
import {
  applyMarkdownTaskInput,
  createLibraryMarkdownEditor,
  joinLibraryMarkdown,
  roundTripLibraryMarkdown,
  splitLibraryMarkdown
} from './library-markdown.js';

const FRONT_MATTER = `---
id: note-1
title: Untitled idea
summary: a note
tags: [idea]
createdAt: 1700000000000
---
`;

describe('splitLibraryMarkdown', () => {
  it('keeps a YAML front-matter header byte-for-byte and returns the body', () => {
    const raw = `${FRONT_MATTER}# Heading\n\nHello.\n`;
    const { header, body } = splitLibraryMarkdown(raw);
    expect(header).toBe(FRONT_MATTER);
    expect(body).toBe('# Heading\n\nHello.\n');
    expect(joinLibraryMarkdown(header, body)).toBe(raw);
  });

  it('passes documents without a header through as the body', () => {
    const raw = '# Just a heading\n\nbody';
    expect(splitLibraryMarkdown(raw)).toEqual({ header: '', body: raw });
  });

  it('treats a front-matter-only file as header with an empty body', () => {
    const raw = '---\nid: note-1\n---';
    expect(splitLibraryMarkdown(raw)).toEqual({ header: raw, body: '' });
  });
});

describe('library markdown editor stack', () => {
  it('loads the markdown, table, and task-list extensions', () => {
    const editor = createLibraryMarkdownEditor('# Hello');
    try {
      const names = editor.extensionManager.extensions.map((ext) => ext.name);
      expect(names).toEqual(expect.arrayContaining(['markdown', 'tableKit', 'taskList', 'taskItem', 'markdownTaskInput']));
    } finally {
      editor.destroy();
    }
  });

  it('turns a markdown checkbox shortcut into a task item', () => {
    const open = createLibraryMarkdownEditor('open item');
    try {
      open.commands.selectAll();
      applyMarkdownTaskInput(
        () => open.chain(),
        { from: open.state.selection.from, to: open.state.selection.to },
        ' '
      );
      expect(open.isActive('taskList')).toBe(true);
      expect(open.isActive('taskItem', { checked: true })).toBe(false);
    } finally {
      open.destroy();
    }

    const checked = createLibraryMarkdownEditor('done item');
    try {
      checked.commands.selectAll();
      applyMarkdownTaskInput(
        () => checked.chain(),
        { from: checked.state.selection.from, to: checked.state.selection.to },
        'x'
      );
      expect(checked.isActive('taskList')).toBe(true);
    } finally {
      checked.destroy();
    }
  });
});

describe('library markdown round-trip', () => {
  it('round-trips a front-matter-only document without dropping the header', () => {
    const raw = '---\nid: note-1\n---';
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(raw)).toBe(true);
  });

  it('preserves front-matter and headings', () => {
    const raw = `${FRONT_MATTER}# Untitled idea\n\nA short paragraph.\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toContain('# Untitled idea');
    expect(out).toContain('A short paragraph.');
  });

  it('does not drop a mermaid fence', () => {
    const raw = `${FRONT_MATTER}See the flow:\n\n\`\`\`mermaid\ngraph TD\n  A --> B\n\`\`\`\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toMatch(/```mermaid\b/);
    expect(out).toContain('graph TD');
    expect(out).toContain('A --> B');
  });

  it('round-trips a GFM table', () => {
    const raw = `${FRONT_MATTER}| Col A | Col B |\n| --- | --- |\n| one | two |\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toContain('|');
    expect(out).toMatch(/Col A/);
    expect(out).toMatch(/one/);
    expect(out).toMatch(/two/);
  });

  it('round-trips a task list', () => {
    const raw = `${FRONT_MATTER}- [ ] open item\n- [x] done item\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toMatch(/\[\s?\]\s+open item/);
    expect(out).toMatch(/\[[xX]\]\s+done item/);
  });

  it('round-trips a fenced code block with a language', () => {
    const raw = `${FRONT_MATTER}\`\`\`ts\nconst x = 1;\n\`\`\`\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toMatch(/```ts\b/);
    expect(out).toContain('const x = 1;');
  });

  it('keeps a tight bullet list as a list', () => {
    const raw = `${FRONT_MATTER}- alpha\n- beta\n- gamma\n`;
    const out = roundTripLibraryMarkdown(raw);
    expect(out.startsWith(FRONT_MATTER)).toBe(true);
    expect(out).toMatch(/[-*]\s+alpha/);
    expect(out).toMatch(/[-*]\s+beta/);
    expect(out).toMatch(/[-*]\s+gamma/);
  });
});

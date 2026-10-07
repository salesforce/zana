/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { PluginMarkdownDirectives } from './PluginMarkdownDirectives.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';
import { consumePendingOpenFile, resetThreadOpenFileBuffer } from '../components/thread/secondary-panel/useThreadOpenFileSignal.js';

vi.mock('../lib/product-client.js', () => ({ product: { threads: { onOpen: () => () => undefined } } }));
const header = ':::comment{id="review" file="src/model.js" lines="17-20" priority="p1" title="Collaborator edit is lost"}';
afterEach(() => { cleanup(); resetThreadOpenFileBuffer(); clearPluginSlots('docs'); });

it('renders the header as a review card and opens the file at the first line', () => {
  render(<PluginMarkdownDirectives text={header} threadId="thr-1" messageId="msg-1" />);
  expect(screen.getByTestId('thread-review-comment').textContent).toContain('P1');
  expect(screen.getByText('Collaborator edit is lost')).toBeTruthy();
  expect(document.body.textContent).not.toContain(':::comment');
  fireEvent.click(screen.getByRole('button', { name: 'Preview src/model.js:17-20' }));
  expect(consumePendingOpenFile('thr-1')).toEqual({ source: 'workspace', path: 'src/model.js', lineNumber: 17 });
});

it('streams into one card without losing surrounding markdown or rendering the closer', () => {
  const view = render(<PluginMarkdownDirectives text={'Intro.\n\n:::comment{title="Par'} threadId="thr-1" messageId="msg-1" />);
  expect(screen.queryByTestId('thread-review-comment')).toBeNull();
  expect(document.body.textContent).toContain(':::comment');
  view.rerender(<PluginMarkdownDirectives text={`Intro.\n\n${header}\n\nFirst **paragraph**.\n\nSecond.`} threadId="thr-1" messageId="msg-1" />);
  const card = screen.getByTestId('thread-review-comment');
  expect(card.querySelector('strong')?.textContent).toBe('Collaborator edit is lost');
  expect(card.querySelector('.inbox-md strong')?.textContent).toBe('paragraph');
  expect(card.textContent).toContain('Second.');
  view.rerender(<PluginMarkdownDirectives text={`Intro.\n\n${header}\n\nFirst **paragraph**.\n\nSecond.\n:::\n\nAfter.`} threadId="thr-1" messageId="msg-1" />);
  expect(screen.getByTestId('thread-review-comment')).toBe(card);
  expect(screen.getByText('Intro.')).toBeTruthy();
  expect(screen.getByText('After.')).toBeTruthy();
  expect(document.body.textContent).not.toContain(':::');
});

it('keeps metadata readable without a thread and omits absent metadata', () => {
  render(<PluginMarkdownDirectives text={`${header}\n:::\n:::comment{title="General finding"}\nbody\n:::`} messageId="msg-1" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('src/model.js:17-20')).toBeTruthy();
  expect(screen.getAllByTestId('thread-review-comment')).toHaveLength(2);
  expect(screen.getByText('body')).toBeTruthy();
});

it('keeps unsafe file paths inert and invalid lines out of preview requests', () => {
  render(<PluginMarkdownDirectives text={':::comment{title="Unsafe" file="../secret"}\n:::\n:::comment{title="Invalid line" file="src/model.js" lines="0"}\n:::'} threadId="thr-1" messageId="msg-1" />);
  expect(screen.getByText('../secret').tagName).toBe('SPAN');
  fireEvent.click(screen.getByRole('button', { name: 'Preview src/model.js:0' }));
  expect(consumePendingOpenFile('thr-1')?.lineNumber).toBeNull();
});

it('coexists with plugin directives and keeps directives inside comments in their body', () => {
  interpretPluginApp('docs', definePluginApp((app) => {
    app.slots.messageDirective({ id: 'doc', component: () => <span data-testid="plugin-doc">Document</span> });
  }));
  render(<PluginMarkdownDirectives text={`::doc{path="a.md"}\n\n${header}\n::doc{path="literal.md"}\n:::\n\n::unknown{value="literal"}\n\n::doc{path="b.md"}`} threadId="thr-1" messageId="msg-1" />);
  expect(screen.getAllByTestId('plugin-doc')).toHaveLength(2);
  expect(screen.getByTestId('thread-review-comment').textContent).toContain('::doc');
  expect(document.body.textContent).toContain('::unknown');
});

it('keeps fenced examples literal', () => {
  render(<PluginMarkdownDirectives text={`\`\`\`md\n${header}\n\`\`\``} threadId="thr-1" messageId="msg-1" />);
  expect(screen.queryByTestId('thread-review-comment')).toBeNull();
  expect(document.querySelector('pre')?.textContent).toContain(':::comment');
});

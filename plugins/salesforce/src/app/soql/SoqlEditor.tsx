import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { formatQuery } from './soql-ast.js';
import { soqlCompletions, type SoqlCompletion } from './soql-completions.js';
import type { SObjectListEntry, SoqlSObjectDescribe } from '../../../lib/soql-describe.js';

export interface SoqlEditorHandle {
  insert(snippet: string): void;
  getCursor(): number;
  focus(): void;
}

export const SoqlEditor = forwardRef<
  SoqlEditorHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
    catalogs: { standard: SObjectListEntry[]; tooling: SObjectListEntry[] };
    useToolingApi: boolean;
    describe?: SoqlSObjectDescribe | null;
    error?: { message: string; line?: number; column?: number } | null;
  }
>(function SoqlEditor(props, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [completions, setCompletions] = useState<SoqlCompletion[]>([]);

  useImperativeHandle(ref, () => ({
    insert(snippet: string) {
      const el = area.current;
      if (!el) {
        props.onChange(`${props.value}${snippet}`);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${props.value.slice(0, start)}${snippet}${props.value.slice(end)}`;
      props.onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
    },
    getCursor() {
      return area.current?.selectionStart ?? props.value.length;
    },
    focus() {
      area.current?.focus();
    }
  }));

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      props.onRun();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      return;
    }
    if (event.key === ' ' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const cursor = area.current?.selectionStart ?? props.value.length;
      setCompletions(
        soqlCompletions({
          soql: props.value,
          cursor,
          catalogs: props.catalogs,
          useToolingApi: props.useToolingApi,
          describe: props.describe
        })
      );
    }
    if (event.key === 'Escape') setCompletions([]);
  };

  return (
    <div className="sf-soql-editor">
      <textarea
        ref={area}
        className="sf-soql-textarea"
        data-testid="soql-editor"
        aria-label="SOQL query"
        spellCheck={false}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="sf-soql-editor-meta">
        <button
          type="button"
          className="sf-soql-btn"
          onClick={() => props.onChange(formatQuery(props.value))}
        >
          Format
        </button>
        <span className="sf-soql-hint">⌘/Ctrl+Enter to run · Ctrl+Space for suggestions</span>
      </div>
      {props.error ? (
        <p className="sf-soql-editor-error" data-testid="soql-editor-error">
          {props.error.line != null ? `Line ${props.error.line}:${props.error.column ?? 1} · ` : ''}
          {props.error.message}
        </p>
      ) : null}
      {completions.length > 0 ? (
        <ul className="sf-soql-completions" data-testid="soql-completions">
          {completions.map((item) => (
            <li key={`${item.kind}:${item.label}:${item.insertText}`}>
              <button
                type="button"
                onClick={() => {
                  const el = area.current;
                  const start = el?.selectionStart ?? props.value.length;
                  const end = el?.selectionEnd ?? start;
                  props.onChange(`${props.value.slice(0, start)}${item.insertText}${props.value.slice(end)}`);
                  setCompletions([]);
                }}
              >
                <span>{item.label}</span>
                <span className="sf-soql-muted">{item.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

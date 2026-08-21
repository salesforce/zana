import { useCallback, useRef, useState } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Modal } from './Modal.js';
import { useUi } from '../store.js';
import { buildSurroundingContext } from '../lib/aiEnhanceContext.js';

const ACTION_ID = 'zcc.ai-enhance-selection';

type StandaloneEditor = Parameters<OnMount>[0];

interface PendingEnhance {
  editor: StandaloneEditor;
  selectionText: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Wires the "Ask AI to enhance selected text" Monaco context-menu action onto
 * an editor instance, plus the small instruction dialog + LLM round-trip that
 * powers it. Shared by every Monaco surface that edits real file content
 * (`DocPreview`'s note editor, the Explorer's `FileViewer`) so the affordance
 * and behavior are identical everywhere — pass `registerEditor` as (or chain it
 * into) that surface's Monaco `onMount`, and render `modal` once alongside the
 * editor.
 *
 * The action only shows up in the context menu when there's a non-empty
 * selection (`editorHasSelection`) and the editor isn't read-only. On trigger
 * it captures the selected text + a bounded window of surrounding file text
 * for style context, asks for a one-line instruction, runs the
 * `builtin:enhance-selection` LLM micro-call via `window.cc.llmPrompts.test`,
 * and replaces the ORIGINAL selection range with the result via
 * `executeEdits` (so Monaco's own undo stack covers it — ⌘Z reverts the AI
 * edit like any other keystroke). The caller's own `onChange`/`onDidChangeModelContent`
 * observes the resulting value change same as a manual edit; this component
 * never writes to disk itself.
 */
export function useAiEnhanceSelection() {
  const pushToast = useUi((s) => s.pushToast);
  const [pending, setPending] = useState<PendingEnhance | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  // Avoid double-registering the action if the same editor instance somehow
  // mounts twice (React strict-mode style remount).
  const registeredRef = useRef<WeakSet<StandaloneEditor>>(new WeakSet());

  const registerEditor: OnMount = useCallback((ed) => {
    if (registeredRef.current.has(ed)) return;
    registeredRef.current.add(ed);
    ed.addAction({
      id: ACTION_ID,
      label: 'Ask AI to enhance selected text',
      precondition: 'editorHasSelection && !editorReadonly',
      contextMenuGroupId: '9_cutcopypaste',
      contextMenuOrder: 5,
      run: (editor) => {
        const model = editor.getModel();
        const selection = editor.getSelection();
        if (!model || !selection || selection.isEmpty()) return;
        const selectionText = model.getValueInRange(selection);
        const startOffset = model.getOffsetAt(selection.getStartPosition());
        const endOffset = model.getOffsetAt(selection.getEndPosition());
        setInstruction('');
        setPending({ editor: editor as StandaloneEditor, selectionText, startOffset, endOffset });
      }
    });
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setPending(null);
  }, [busy]);

  const submit = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const model = pending.editor.getModel();
      const fullText = model?.getValue() ?? pending.selectionText;
      const context = buildSurroundingContext(fullText, pending.startOffset, pending.endOffset);
      const res = await window.cc.llmPrompts.test('builtin:enhance-selection', {
        selection: pending.selectionText,
        context,
        instruction: instruction.trim() || 'Improve clarity and correctness.'
      });
      if (!res.ok || !res.text.trim()) {
        pushToast(res.error ? `Couldn’t enhance selection: ${res.error}` : 'Couldn’t enhance selection', 'error');
        return;
      }
      const replacement = res.text.trim();
      const currentModel = pending.editor.getModel();
      if (!currentModel) return;
      const range = {
        startLineNumber: currentModel.getPositionAt(pending.startOffset).lineNumber,
        startColumn: currentModel.getPositionAt(pending.startOffset).column,
        endLineNumber: currentModel.getPositionAt(pending.endOffset).lineNumber,
        endColumn: currentModel.getPositionAt(pending.endOffset).column
      };
      pending.editor.executeEdits(ACTION_ID, [{ range, text: replacement, forceMoveMarkers: true }]);
      pending.editor.pushUndoStop();
      pending.editor.focus();
      setPending(null);
      pushToast('Selection enhanced');
    } catch (err) {
      pushToast(`Couldn’t enhance selection: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [pending, instruction, pushToast]);

  const modal = pending && (
    <Modal
      title="Ask AI to enhance selected text"
      onClose={close}
      className="ai-enhance-modal"
      footer={
        <>
          <button className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={13} className="improve-prompt-spin" aria-hidden="true" /> Enhancing…
              </>
            ) : (
              <>
                <Sparkles size={13} aria-hidden="true" /> Enhance
              </>
            )}
          </button>
        </>
      }
    >
      <div className="ai-enhance-selection-preview">{pending.selectionText}</div>
      <label className="prompt-modal-field">
        <span>Instruction (optional)</span>
        <input
          autoFocus
          value={instruction}
          placeholder="e.g. make this more concise, fix grammar, add error handling…"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </label>
    </Modal>
  );

  return { registerEditor, modal };
}

import { product } from '../lib/product-client.js';
import { useState } from 'react';
import { Sparkles, Undo2, Loader2 } from 'lucide-react';
import { useUi } from '../store.js';

/**
 * "✨ Improve prompt" — a small ghost button that sits under an
 * agent-instruction field. It runs the `builtin:improve-prompt` LLM micro-call
 * on the current text and writes the rewritten prompt back via `onChange`.
 *
 * Shared by every surface where the user types an instruction for an agent
 * (the launchers' PromptComposer, persona/team editors, the scheduler), so the
 * affordance and behaviour stay identical everywhere.
 *
 * Safety / UX:
 *  - Disabled while the call is in flight (spinner) and when the field is empty.
 *  - On failure (offline, no provider, timeout) it toasts and leaves the user's
 *    text untouched — never loses input.
 *  - After a successful improve it offers a one-click Undo (↺) that restores the
 *    exact pre-improve text; the undo is dropped as soon as the user edits again
 *    (the parent owns `value`, so a changed value clears our stored original).
 */
interface Props {
  /** Current field value (controlled by the parent). */
  value: string;
  /** Write the improved (or restored) text back to the parent. */
  onChange: (next: string) => void;
  /** Optional extra class on the wrapper for per-surface spacing tweaks. */
  className?: string;
}

export function ImprovePromptButton({ value, onChange, className }: Props) {
  const [busy, setBusy] = useState(false);
  // The text as it was just before the last successful improve, so we can undo.
  // Cleared whenever the live value no longer matches what we produced.
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const pushToast = useUi((s) => s.pushToast);

  const canImprove = value.trim().length > 0 && !busy;
  // Offer undo only while the field still holds exactly what we wrote (an edit
  // since then makes the restore point stale, so we hide it).
  const canUndo = undo !== null && undo.after === value && !busy;

  const improve = async () => {
    const original = value;
    setBusy(true);
    try {
      const res = await product.llmPrompts.test('builtin:improve-prompt', { prompt: original });
      if (!res.ok || !res.text.trim()) {
        pushToast(res.error ? `Couldn’t improve prompt: ${res.error}` : 'Couldn’t improve prompt', 'error');
        return;
      }
      const improved = res.text.trim();
      onChange(improved);
      setUndo({ before: original, after: improved });
    } catch (err) {
      pushToast(`Couldn’t improve prompt: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revert = () => {
    if (!undo) return;
    onChange(undo.before);
    setUndo(null);
  };

  return (
    <div className={`improve-prompt ${className ?? ''}`}>
      {canUndo && (
        <button
          type="button"
          className="improve-prompt-undo"
          onClick={revert}
          title="Revert to your original prompt"
          aria-label="Revert to your original prompt"
        >
          <Undo2 size={12} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="improve-prompt-btn"
        onClick={improve}
        disabled={!canImprove}
        title={canImprove ? 'Rewrite this into a clearer prompt (LLM)' : 'Type an instruction first'}
      >
        {busy ? (
          <Loader2 size={13} className="improve-prompt-spin" aria-hidden="true" />
        ) : (
          <Sparkles size={13} aria-hidden="true" />
        )}
        {busy ? 'Improving…' : 'Improve prompt'}
      </button>
    </div>
  );
}

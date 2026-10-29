import { useState } from 'react';
import { parseLabScenario, type LabScenario } from '../../../lib/agentforce-lab-contract.js';
import type { PreviewContextVariable } from '../../../lib/preview-context.js';
import type { ScenarioLibraryControls } from './useScenarioLibrary.js';

/** Saving is explicit: runner edits stay local until the user names a shared copy. */
export function SaveSharedScenario({ library, scenario, name, values, disabled }: { library: ScenarioLibraryControls; scenario: LabScenario; name: string; values: PreviewContextVariable[]; disabled?: boolean }) {
  const [copyName, setCopyName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  return <div className="sf-shared-save">
    <button type="button" className="sf-tp-btn" disabled={disabled || busy} onClick={() => { setCopyName(`${name} copy`.slice(0, 80)); setMessage(''); setError(''); }}>Save as shared scenario</button>
    {copyName !== null && <form onSubmit={event => {
      event.preventDefault(); if (busy || disabled) return;
      setBusy(true); setError('');
      void Promise.resolve().then(() => library.save({ ...parseLabScenario(scenario), name: copyName, contextVariables: values })).then(row => { setCopyName(null); setMessage(`Saved “${row.name}” to Scenarios.`); }).catch(error => setError((error as Error).message)).finally(() => setBusy(false));
    }}>
      <label>Shared scenario name <input aria-label="Shared scenario name" maxLength={80} value={copyName} disabled={busy} onChange={event => setCopyName(event.target.value)} /></label>
      <button type="submit" className="sf-tp-btn" disabled={busy || disabled || !copyName.trim()}>Save shared copy</button>
      <button type="button" className="sf-tp-btn" disabled={busy} onClick={() => setCopyName(null)}>Cancel</button>
    </form>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}

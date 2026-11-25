import { useEffect, useRef, useState } from 'react';
import { errorMessage, toast, useApi } from './api.js';

/** "Sync behavior" preference: settle safe peer changes without asking. Saves on change, reverts on failure. */
export function AutoConvergeToggle() {
  const api = useApi();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void api.autoConverge()
      .then((value) => { if (mounted.current) setEnabled(value.enabled); })
      .catch((error) => { if (mounted.current) toast(errorMessage(error), 'error'); });
    return () => { mounted.current = false; };
  }, [api]);
  const change = (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setPending(true);
    void api.setAutoConverge(next)
      .then((value) => { if (mounted.current) setEnabled(value.enabled); })
      .catch((error) => { if (mounted.current) setEnabled(previous); toast(errorMessage(error), 'error'); })
      .finally(() => { if (mounted.current) setPending(false); });
  };
  return (
    <section className="dd-peers-block dd-peers-behavior" aria-label="Sync behavior">
      <h4>Sync behavior</h4>
      <label className="dd-peers-toggle">
        <input
          type="checkbox"
          role="switch"
          checked={enabled === true}
          disabled={enabled === null || pending}
          onChange={(event) => change(event.target.checked)}
        />
        <span>Automatically settle safe peer changes</span>
      </label>
      <p className="dd-peers-hint">Reconcile identical copies and non-overlapping edits without asking. Overlapping edits still require review.</p>
    </section>
  );
}

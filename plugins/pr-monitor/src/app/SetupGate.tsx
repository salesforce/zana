/**
 * First-run welcome. Until the user opts in once, the panel shows this gate
 * instead of any board content; "Get started" persists the default settings to
 * `host.storage` under the canonical settings key, and the parent panel switches
 * over to the live UI on the next render.
 *
 * PR Monitor always renders in BOTH surfaces (global sidebar + each project's
 * PRs tab — AC-NAV-2.3/3.5), so there is no display-mode choice to make here;
 * the gate exists only to record that the user has explicitly enabled the
 * extension before the background poller starts surfacing PRs.
 */

import { useState } from 'react';
import { GitPullRequest } from 'lucide-react';
import { type PrMonitorSettings, DEFAULT_PR_MONITOR_SETTINGS } from '../../lib/types.js';

interface Props {
  /** Called with the chosen initial settings; the parent persists + activates. */
  onSave: (initial: PrMonitorSettings) => Promise<void>;
}

export function SetupGate({ onSave }: Props) {
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ ...DEFAULT_PR_MONITOR_SETTINGS });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="prm-setup-gate">
      <div className="prm-setup">
        <GitPullRequest size={32} aria-hidden />
        <h3>Set up PR Monitor</h3>
        <p>
          Track the pull requests you care about — in the global sidebar and on
          each project's PRs tab. Add PRs by URL, or turn on auto-discovery in
          Settings to surface the ones you author, review, or are mentioned in.
        </p>
        <div className="prm-empty-actions">
          <button
            type="button"
            className="prm-btn prm-btn--primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}

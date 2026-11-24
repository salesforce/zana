import { useContext, useEffect, useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { CheckboxField } from './FormFields';
import { SquadBlockerReminderRow, DEFAULT_BLOCKER_REMINDER_MINUTES } from './SquadBlockerReminderRow';
import { RevealContext } from '@/lib/settings-search/reveal';

type Update = (patch: Partial<AppConfig>, opts?: { throwOnError?: boolean }) => void | Promise<unknown>;

/** One-line state shown beside the collapsed heading, e.g. "Reminder 30 min · Checkpoints on". */
export function squadAdvancedSummary(config: AppConfig): string {
  const ms = config.executionBlockerReminderMs;
  const reminder = ms === undefined ? `${DEFAULT_BLOCKER_REMINDER_MINUTES} min` : ms <= 0 ? 'off' : `${Math.round(ms / 60_000)} min`;
  return `Reminder ${reminder} · Checkpoints ${config.squadUnitCheckpointsEnabled === false ? 'off' : 'on'}`;
}

/** Squad-wide run settings under the squad list: collapsed by default, like a squad's own Advanced block. */
export function SquadAdvancedSettings({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft?: (config: AppConfig) => void;
  onUpdate: Update;
}) {
  const [open, setOpen] = useState(false);
  // A settings-search result inside this block expands it before scrolling.
  const reveal = useContext(RevealContext);
  useEffect(() => {
    if (reveal.reveal === 'advanced' && reveal.target?.startsWith('squads.')) setOpen(true);
  }, [reveal]);

  return (
    <details
      className="squads-advanced"
      data-testid="squads-advanced"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Advanced <small data-testid="squads-advanced-summary">{squadAdvancedSummary(config)}</small>
      </summary>
      <div className="squads-advanced-body">
        <SquadBlockerReminderRow config={config} onUpdate={onUpdate} />
        <div id="settings-anchor-squad-unit-checkpoints">
          <CheckboxField
            label="Checkpoint each unit"
            searchId="squads.unit-checkpoints"
            help="Record what each Squad unit changes in its checkout, including shell commands, and undo a failed unit's own edits when it is safe. Files another unit also touched are left alone."
            checked={config.squadUnitCheckpointsEnabled !== false}
            onChange={(squadUnitCheckpointsEnabled) => {
              onConfigDraft?.({ ...config, squadUnitCheckpointsEnabled });
              void onUpdate({ squadUnitCheckpointsEnabled });
            }}
          />
        </div>
      </div>
    </details>
  );
}

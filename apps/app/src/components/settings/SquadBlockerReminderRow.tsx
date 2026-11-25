import { useEffect, useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { SettingsActionRow } from './FormFields';

/** Default wait before a human blocker is reminded, in minutes (main's `DEFAULT_BLOCKER_REMINDER_MS`). */
export const DEFAULT_BLOCKER_REMINDER_MINUTES = 30;
/** Bounds for a non-zero window, in minutes; main clamps to the same range (rule 1: renderer checks are advisory). */
export const MIN_BLOCKER_REMINDER_MINUTES = 1;
export const MAX_BLOCKER_REMINDER_MINUTES = 1440;

export type BlockerReminderParse = { ok: true; ms: number } | { ok: false; error: string };

/** Blank means the default, 0 means off, otherwise whole minutes within the bounds. */
export function parseBlockerReminderMinutes(raw: string): BlockerReminderParse {
  const text = raw.trim();
  if (text === '') return { ok: true, ms: DEFAULT_BLOCKER_REMINDER_MINUTES * 60_000 };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number of minutes, or 0 to turn reminders off.' };
  const minutes = Number(text);
  if (minutes === 0) return { ok: true, ms: 0 };
  if (minutes < MIN_BLOCKER_REMINDER_MINUTES || minutes > MAX_BLOCKER_REMINDER_MINUTES) {
    return { ok: false, error: `Enter ${MIN_BLOCKER_REMINDER_MINUTES} to ${MAX_BLOCKER_REMINDER_MINUTES} minutes, or 0 to turn reminders off.` };
  }
  return { ok: true, ms: minutes * 60_000 };
}

function minutesText(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  return String(ms <= 0 ? 0 : Math.round(ms / 60_000));
}

export function SquadBlockerReminderRow({
  config,
  onUpdate
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>, opts?: { throwOnError?: boolean }) => void | Promise<unknown>;
}) {
  const saved = minutesText(config.executionBlockerReminderMs);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(saved); setError(null); }, [saved]);

  const commit = () => {
    // Untouched (Enter then blur, or focus then blur) never writes: an unset value stays "absent = default".
    if (draft.trim() === saved) { setError(null); return; }
    const parsed = parseBlockerReminderMinutes(draft);
    if (!parsed.ok) { setError(parsed.error); return; }
    setError(null);
    if (parsed.ms === config.executionBlockerReminderMs) return;
    const failed = () => setError('Could not save. Try again.');
    try { Promise.resolve(onUpdate({ executionBlockerReminderMs: parsed.ms }, { throwOnError: true })).catch(failed); } catch { failed(); }
  };

  return (
    <div id="settings-anchor-squad-blocker-reminder">
      <SettingsActionRow
        label="Squad question reminders"
        searchId="squads.blocker-reminder.minutes"
        help={`Remind me after this many minutes of waiting for your answer: one Inbox row and a desktop notification. Blank is ${DEFAULT_BLOCKER_REMINDER_MINUTES}, 0 is off, range ${MIN_BLOCKER_REMINDER_MINUTES}–${MAX_BLOCKER_REMINDER_MINUTES}. Applies to runs in progress.`}
      >
        <input
          type="text"
          inputMode="numeric"
          className="squads-advanced-minutes"
          aria-label="Remind me after (minutes)"
          value={draft}
          placeholder={String(DEFAULT_BLOCKER_REMINDER_MINUTES)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'squad-blocker-reminder-error' : undefined}
          onChange={(event) => { setDraft(event.target.value); if (error) setError(null); }}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
        />
      </SettingsActionRow>
      {error && <p id="squad-blocker-reminder-error" role="alert" className="settings-help team-editor-danger">{error}</p>}
    </div>
  );
}

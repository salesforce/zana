import { Users } from 'lucide-react';
import type { LaunchMode } from '../lib/launch-mode-preference.js';

export type { LaunchMode };

export function LaunchModeSegmented({
  value,
  onChange,
  showCliAgent = true,
  showModern = true,
  showTeam
}: {
  value: LaunchMode;
  onChange: (mode: LaunchMode) => void;
  showCliAgent?: boolean;
  showModern?: boolean;
  showTeam: boolean;
}) {
  return (
    <div className="launch-segmented" role="group" aria-label="Launch mode">
      {showCliAgent && (
        <button
          type="button"
          className={value === 'agent' ? 'active' : ''}
          onClick={() => onChange('agent')}
          aria-pressed={value === 'agent'}
        >
          CLI Agent
        </button>
      )}
      {showModern && (
        <button
          type="button"
          className={value === 'thread' ? 'active' : ''}
          onClick={() => onChange('thread')}
          aria-pressed={value === 'thread'}
        >
          Modern
          <span className="launch-segmented-new" aria-hidden="true">NEW</span>
        </button>
      )}
      {showTeam && (
        <button
          type="button"
          className={value === 'team' ? 'active' : ''}
          onClick={() => onChange('team')}
          aria-pressed={value === 'team'}
        >
          <Users size={13} /> Team
        </button>
      )}
    </div>
  );
}

import { Users, Zap } from 'lucide-react';
import type { LaunchMode } from '../lib/launch-mode-preference.js';

export type { LaunchMode };

export function LaunchModeSegmented({
  value,
  onChange,
  showCliAgent = true,
  showModern = true,
  showAutonomousTeam,
  showJobTeam
}: {
  value: LaunchMode;
  onChange: (mode: LaunchMode) => void;
  showCliAgent?: boolean;
  showModern?: boolean;
  showAutonomousTeam: boolean;
  showJobTeam: boolean;
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
      {showAutonomousTeam && (
        <button
          type="button"
          className={value === 'autonomous' ? 'active' : ''}
          onClick={() => onChange('autonomous')}
          aria-pressed={value === 'autonomous'}
        >
          <Zap size={13} /> Autonomous Team
        </button>
      )}
      {showJobTeam && (
        <button
          type="button"
          className={value === 'job' ? 'active' : ''}
          onClick={() => onChange('job')}
          aria-pressed={value === 'job'}
        >
          <Users size={13} /> Job Team
        </button>
      )}
    </div>
  );
}

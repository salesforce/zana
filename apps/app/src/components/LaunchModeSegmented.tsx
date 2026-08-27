import { Zap } from 'lucide-react';

export type LaunchMode = 'thread' | 'agent' | 'autonomous';

export function LaunchModeSegmented({
  value,
  onChange,
  showAutonomousTeam
}: {
  value: LaunchMode;
  onChange: (mode: LaunchMode) => void;
  showAutonomousTeam: boolean;
}) {
  return (
    <div className="launch-segmented" role="group" aria-label="Launch mode">
      <button
        type="button"
        className={value === 'thread' ? 'active' : ''}
        onClick={() => onChange('thread')}
        aria-pressed={value === 'thread'}
      >
        Thread
      </button>
      <button
        type="button"
        className={value === 'agent' ? 'active' : ''}
        onClick={() => onChange('agent')}
        aria-pressed={value === 'agent'}
      >
        Legacy Agent
      </button>
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
    </div>
  );
}

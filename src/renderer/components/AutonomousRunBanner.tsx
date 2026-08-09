import { Zap, Square } from 'lucide-react';
import { useAutonomousRuns } from '../store';

/**
 * Shows the active autonomous run for a project: its goal, nudge count, and a
 * Stop button. Hidden when no run is running for the project. Observation of the
 * agents themselves is the existing SquadFlowView below it on the board.
 */
export function AutonomousRunBanner({ projectId }: { projectId: string }) {
  const run = useAutonomousRuns((s) =>
    s.runs.find((r) => r.projectId === projectId && r.state === 'running')
  );
  if (!run) return null;

  const stop = () => {
    void window.cc.teams.stopAutonomous(run.runId);
  };

  return (
    <div className="autonomous-run-banner" role="status">
      <span className="autonomous-run-icon" aria-hidden="true">
        <Zap size={14} />
      </span>
      <div className="autonomous-run-body">
        <span className="autonomous-run-label">Autonomous team running</span>
        <span className="autonomous-run-goal" title={run.goal}>
          {run.goal}
        </span>
      </div>
      <span className="autonomous-run-rounds">{run.rounds} nudges</span>
      <button
        type="button"
        className="btn autonomous-run-stop"
        onClick={stop}
        title="Stop this autonomous run"
      >
        <Square size={12} />
        Stop
      </button>
    </div>
  );
}

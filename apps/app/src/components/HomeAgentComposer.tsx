import { useEffect, useState } from 'react';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { AutonomousTeamComposer } from './AutonomousTeamComposer.js';
import { JobTeamComposer } from './JobTeamComposer.js';
import { LaunchModeSegmented, type LaunchMode } from './LaunchModeSegmented.js';
import { useData, useTeams, useUi } from '../store.js';
import { useShallow } from 'zustand/react/shallow';

export { parseHomeLauncherPreferences } from './home-launcher-preferences.js';

export interface HomeAgentComposerProps extends ThreadCommandComposerProps {
  /** New Chat (`nav === 'home'`) only — New Thread stays on the HTTP thread path. */
  allowLegacyAgent?: boolean;
}

/** Dashboard wrapper only — thread detail must not inherit this spacing. */
export function HomeAgentComposer({
  allowLegacyAgent = false,
  ...props
}: HomeAgentComposerProps) {
  const walkthroughHomeMode = useUi((s) => s.walkthroughHomeMode);
  const teams = useTeams(useShallow((s) => s.teams));
  const teamJobLaunchEnabled = useData((s) => s.teamJobLaunchEnabled);
  const showAutonomousTeam = teams.length > 0;
  const showJobTeam = teamJobLaunchEnabled && teams.length > 0;
  const [kind, setKind] = useState<LaunchMode>('thread');
  useEffect(() => {
    if (walkthroughHomeMode === 'thread' || walkthroughHomeMode === 'agent') {
      setKind(walkthroughHomeMode);
    }
  }, [walkthroughHomeMode]);
  useEffect(() => {
    if (kind === 'autonomous' && !showAutonomousTeam) setKind('thread');
    if (kind === 'job' && !showJobTeam) setKind('thread');
  }, [kind, showAutonomousTeam, showJobTeam]);
  return (
    <div className={`home-agent-composer${walkthroughHomeMode ? ' is-walkthrough-spotlight' : ''}`}>
      {allowLegacyAgent && (
        <LaunchModeSegmented
          value={kind}
          onChange={setKind}
          showAutonomousTeam={showAutonomousTeam}
          showJobTeam={showJobTeam}
        />
      )}
      {allowLegacyAgent && kind === 'agent' ? (
        <LegacyAgentHomeComposer project={props.project} />
      ) : allowLegacyAgent && kind === 'autonomous' ? (
        <AutonomousTeamComposer project={props.project} />
      ) : allowLegacyAgent && kind === 'job' ? (
        <JobTeamComposer project={props.project} />
      ) : (
        <ThreadCommandComposer {...props} />
      )}
    </div>
  );
}

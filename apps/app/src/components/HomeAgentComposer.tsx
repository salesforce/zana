import { useEffect, useState } from 'react';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { AutonomousTeamComposer } from './AutonomousTeamComposer.js';
import { JobTeamComposer } from './JobTeamComposer.js';
import { LaunchModeSegmented } from './LaunchModeSegmented.js';
import {
  resolveAvailableLaunchMode,
  visibleComposerLaunchModes,
  visibleLaunchModeCount
} from '../lib/launch-mode-preference.js';
import { useLaunchModePreference } from '../lib/use-launch-mode-preference.js';
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
  project,
  ...props
}: HomeAgentComposerProps) {
  const walkthroughHomeMode = useUi((s) => s.walkthroughHomeMode);
  const teams = useTeams(useShallow((s) => s.teams));
  const composerShowCliAgent = useData((s) => s.composerShowCliAgent);
  const composerShowModern = useData((s) => s.composerShowModern);
  const composerShowAutonomousTeam = useData((s) => s.composerShowAutonomousTeam);
  const teamJobLaunchEnabled = useData((s) => s.teamJobLaunchEnabled);
  const available = visibleComposerLaunchModes({
    showCliAgent: walkthroughHomeMode ? true : composerShowCliAgent,
    showModern: walkthroughHomeMode ? true : composerShowModern,
    showAutonomousTeam: composerShowAutonomousTeam,
    showJobTeam: teamJobLaunchEnabled
  }, { hasTeams: teams.length > 0 });
  const showAutonomousTeam = available.showAutonomousTeam;
  const showJobTeam = available.showJobTeam;
  const [storedMode, setStoredMode] = useLaunchModePreference();
  const preferred = resolveAvailableLaunchMode(storedMode, available);
  const kind = walkthroughHomeMode === 'thread' || walkthroughHomeMode === 'agent'
    ? walkthroughHomeMode
    : preferred;
  const showLaunchSwitcher = Boolean(walkthroughHomeMode) || visibleLaunchModeCount(available) > 1;
  const [composerProjectId, setComposerProjectId] = useState(project?.id ?? '');
  useEffect(() => {
    if (project?.id) setComposerProjectId(project.id);
  }, [project?.id]);
  return (
    <div className={`home-agent-composer${walkthroughHomeMode ? ' is-walkthrough-spotlight' : ''}`}>
      {allowLegacyAgent && showLaunchSwitcher && (
        <LaunchModeSegmented
          value={kind}
          onChange={setStoredMode}
          showCliAgent={available.showCliAgent}
          showModern={available.showModern}
          showAutonomousTeam={showAutonomousTeam}
          showJobTeam={showJobTeam}
        />
      )}
      {allowLegacyAgent && kind === 'agent' ? (
        <LegacyAgentHomeComposer
          project={project}
          composerProjectId={composerProjectId}
          onComposerProjectIdChange={setComposerProjectId}
        />
      ) : allowLegacyAgent && kind === 'autonomous' ? (
        <AutonomousTeamComposer
          project={project}
          composerProjectId={composerProjectId}
          onComposerProjectIdChange={setComposerProjectId}
        />
      ) : allowLegacyAgent && kind === 'job' ? (
        <JobTeamComposer project={project} />
      ) : (
        <ThreadCommandComposer
          {...props}
          project={project}
          composerProjectId={composerProjectId}
          onComposerProjectIdChange={setComposerProjectId}
        />
      )}
    </div>
  );
}

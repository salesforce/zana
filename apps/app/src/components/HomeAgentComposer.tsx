import { useEffect, useState } from 'react';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { AutonomousTeamComposer } from './AutonomousTeamComposer.js';
import { LaunchModeSegmented, type LaunchMode } from './LaunchModeSegmented.js';
import { useTeams, useUi } from '../store.js';
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
  const showAutonomousTeam = teams.length > 0;
  const [kind, setKind] = useState<LaunchMode>('thread');
  const [composerProjectId, setComposerProjectId] = useState(project?.id ?? '');
  const [cliRemoteToolProxy, setCliRemoteToolProxy] = useState(false);
  useEffect(() => {
    if (walkthroughHomeMode === 'thread' || walkthroughHomeMode === 'agent') {
      setKind(walkthroughHomeMode);
    }
  }, [walkthroughHomeMode]);
  useEffect(() => {
    if (kind === 'autonomous' && !showAutonomousTeam) setKind('thread');
  }, [kind, showAutonomousTeam]);
  useEffect(() => {
    if (project?.id) setComposerProjectId(project.id);
  }, [project?.id]);
  return (
    <div className={`home-agent-composer${walkthroughHomeMode ? ' is-walkthrough-spotlight' : ''}`}>
      {allowLegacyAgent && (
        <LaunchModeSegmented
          value={kind}
          onChange={setKind}
          showAutonomousTeam={showAutonomousTeam}
        />
      )}
      {allowLegacyAgent && kind === 'agent' ? (
        <LegacyAgentHomeComposer
          project={project}
          composerProjectId={composerProjectId}
          onComposerProjectIdChange={setComposerProjectId}
          cliRemoteToolProxy={cliRemoteToolProxy}
          onCliRemoteToolProxyChange={setCliRemoteToolProxy}
        />
      ) : allowLegacyAgent && kind === 'autonomous' ? (
        <AutonomousTeamComposer
          project={project}
          composerProjectId={composerProjectId}
          onComposerProjectIdChange={setComposerProjectId}
        />
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

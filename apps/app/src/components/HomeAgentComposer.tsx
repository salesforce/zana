import { useState } from 'react';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';
import { LaunchModeSegmented, type LaunchMode } from './LaunchModeSegmented.js';

export { parseHomeLauncherPreferences } from './home-launcher-preferences.js';

export interface HomeAgentComposerProps extends ThreadCommandComposerProps {
  /** New Chat (`nav === 'home'`) only — New Thread stays on the HTTP thread path. */
  allowLegacyAgent?: boolean;
}

type HomeLaunchMode = Extract<LaunchMode, 'thread' | 'agent'>;

/** Dashboard wrapper only — thread detail must not inherit this spacing. */
export function HomeAgentComposer({
  allowLegacyAgent = false,
  ...props
}: HomeAgentComposerProps) {
  const [kind, setKind] = useState<HomeLaunchMode>('thread');
  return (
    <div className="home-agent-composer">
      {allowLegacyAgent && (
        <LaunchModeSegmented
          value={kind}
          onChange={(next) => {
            if (next !== 'autonomous') setKind(next);
          }}
          showAutonomousTeam={false}
        />
      )}
      {allowLegacyAgent && kind === 'agent' ? (
        <LegacyAgentHomeComposer project={props.project} />
      ) : (
        <ThreadCommandComposer {...props} />
      )}
    </div>
  );
}

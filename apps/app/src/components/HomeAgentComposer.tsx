import { useState } from 'react';
import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';
import { LegacyAgentHomeComposer } from './LegacyAgentHomeComposer.js';

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
  const [kind, setKind] = useState<'thread' | 'legacy'>('thread');
  return (
    <div className="home-agent-composer">
      {allowLegacyAgent && kind === 'legacy' ? (
        <LegacyAgentHomeComposer
          project={props.project}
          onSelectThread={() => setKind('thread')}
        />
      ) : (
        <ThreadCommandComposer
          {...props}
          onSelectLegacyAgent={allowLegacyAgent ? () => setKind('legacy') : undefined}
        />
      )}
    </div>
  );
}

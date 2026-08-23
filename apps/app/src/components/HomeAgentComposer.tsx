import { ThreadCommandComposer, type ThreadCommandComposerProps } from './ThreadCommandComposer.js';

export { parseHomeLauncherPreferences } from './home-launcher-preferences.js';

/** Dashboard wrapper only — thread detail must not inherit this spacing. */
export function HomeAgentComposer(props: ThreadCommandComposerProps) {
  return (
    <div className="home-agent-composer">
      <ThreadCommandComposer {...props} />
    </div>
  );
}

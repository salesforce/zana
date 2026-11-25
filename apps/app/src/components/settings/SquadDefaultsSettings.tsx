import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Field } from './FormFields';
import { PopoverPicklist } from '../ui/PopoverPicklist';
import { PrecedenceStrip } from '../PrecedenceStrip';
import { resolveSquadTransportView, useSquadTransportConfig } from '@/lib/squad-transport';
import { squadDefaultTransportLabel } from '@zana-ai/zcc-domain/squad-transport';

type Update = (patch: Partial<AppConfig>, opts?: { throwOnError?: boolean }) => void | Promise<unknown>;
type GlobalValue = NonNullable<AppConfig['squadDefaultTransport']>;

/** Shown beside the Defaults heading, e.g. "Launch mode: Follow caller". */
export function squadDefaultsSummary(config: AppConfig): string {
  return `Launch mode: ${squadDefaultTransportLabel(config.squadDefaultTransport)}`;
}

/**
 * All Squads launch mode: what a Squad set to "Use default" runs as. A Squad's own choice and the launch
 * picker override it. Visible (not under Advanced) because it decides how every Use default Squad runs.
 */
export function SquadDefaultsSettings({
  config,
  onConfigDraft,
  onUpdate
}: {
  config: AppConfig;
  onConfigDraft?: (config: AppConfig) => void;
  onUpdate: Update;
}) {
  const display = useSquadTransportConfig();
  const value: GlobalValue = config.squadDefaultTransport ?? 'caller';
  // What each inherit-style choice lands on when nothing else decides, so the labels stay honest.
  const viaLaunchMode = resolveSquadTransportView({}, { ...display, squadDefaultTransport: 'follow' }).label;
  const change = (next: GlobalValue) => {
    onConfigDraft?.({ ...config, squadDefaultTransport: next });
    void onUpdate({ squadDefaultTransport: next });
  };
  return (
    <section className="squads-defaults" data-testid="squads-defaults">
      <h3 className="squads-defaults-title">
        Defaults <small data-testid="squads-defaults-summary">{squadDefaultsSummary(config)}</small>
      </h3>
      <div id="settings-anchor-squad-default-launch-mode">
      <Field
        label="All Squads launch mode"
        searchId="squads.default-launch-mode"
        help="What a Squad set to Use default runs as. A Squad's own launch mode and the launch picker override this. Squads that already pin CLI Agent or Modern are not affected."
      >
        <PopoverPicklist
          id="squads-default-launch-mode"
          ariaLabel="All Squads launch mode"
          searchable={false}
          value={value}
          onChange={(next) => change(next as GlobalValue)}
          options={[
            { value: 'caller', label: `Follow caller (${viaLaunchMode} otherwise)`, description: 'Agent-launched Squads match the CLI Agent or Modern session that launched them.' },
            { value: 'follow', label: `Follow Default launch mode (${viaLaunchMode})`, description: "Uses the Composer's Default launch mode." },
            { value: 'CLI', label: 'CLI Agent' },
            { value: 'MODERN', label: 'Modern' }
          ]}
        />
      </Field>
      </div>
      <details className="team-editor-how">
        <summary>How the launch mode is decided</summary>
        <PrecedenceStrip settingKey="squad.transport" />
      </details>
    </section>
  );
}

import type { Team } from '@zana-ai/zcc-domain/product';
import { FleetKindChip } from './FleetKindChip.js';
import {
  resolveSquadTransportView,
  SQUAD_TRANSPORT_SOURCE_TEXT,
  squadTransportKind,
  useSquadTransportConfig
} from '../lib/squad-transport.js';
import type { SquadTransportSource } from '@zana-ai/zcc-domain/squad-transport';
import type { PopoverPicklistOption } from './ui/PopoverPicklist.js';

/** Short tag for a mode the Squad does not pin itself, so "follows the default" never reads as "pinned". */
const INHERITED_HINT: Partial<Record<SquadTransportSource, string>> = {
  caller: 'follows caller',
  global: 'default',
  'launch-mode': 'default',
  fallback: 'fallback',
  'fallback-squad-mode': 'fallback'
};

/** Squad transport pill, styled like the fleet kind pill but named as the app's launch modes: CLI Agent or Modern. */
export function SquadTransportChip({ team, remote }: { team: Pick<Team, 'transport'> & Partial<Pick<Team, 'slots'>>; remote?: boolean }) {
  const view = resolveSquadTransportView(team, useSquadTransportConfig(), { remote });
  const why = view.fallbackReason ? `${SQUAD_TRANSPORT_SOURCE_TEXT[view.source]}: ${view.fallbackReason}` : SQUAD_TRANSPORT_SOURCE_TEXT[view.source];
  // A Squad set to Follow caller reads as such even where no caller exists (the app) and it resolves further down the chain.
  const hint = team.transport === 'CALLER' ? 'follows caller' : INHERITED_HINT[view.source];
  return (
    <span title={why} data-transport-source={view.source}>
      <FleetKindChip kind={squadTransportKind(view.transport)} label={view.label} />
      {hint ? <span className="squad-transport-hint" data-testid="squad-transport-hint" style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>{hint}</span> : null}
    </span>
  );
}

function SquadPicklistRow({ team }: { team: Pick<Team, 'id' | 'name' | 'transport'> }) {
  const view = resolveSquadTransportView(team, useSquadTransportConfig());
  return (
    <span className="squad-picklist-option" data-squad-transport={view.transport}>
      <span className="squad-picklist-option-name">{team.name}</span>
      <SquadTransportChip team={team} />
    </span>
  );
}

/** Squad picker row: name + transport pill, optional description line. */
export function squadPicklistOption(
  team: Pick<Team, 'id' | 'name' | 'description' | 'transport'>,
  { withDescription = false }: { withDescription?: boolean } = {}
): PopoverPicklistOption<string> {
  return {
    value: team.id,
    label: team.name,
    content: <SquadPicklistRow team={team} />,
    ...(withDescription && team.description ? { description: team.description } : {})
  };
}

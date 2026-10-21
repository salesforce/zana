import type { Team } from '@zana-ai/zcc-domain/product';
import { FleetKindChip } from './FleetKindChip.js';
import { squadTransport, squadTransportKind } from '../lib/squad-transport.js';
import type { PopoverPicklistOption } from './ui/PopoverPicklist.js';

/** Squad transport pill, styled like the fleet kind pill but named as the app's launch modes: CLI Agent or Modern. */
export function SquadTransportChip({ team }: { team: Pick<Team, 'transport'> }) {
  const transport = squadTransport(team);
  return <FleetKindChip kind={squadTransportKind(transport)} label={transport === 'MODERN' ? 'Modern' : 'CLI Agent'} />;
}

/** Squad picker row: name + transport pill, optional description line. */
export function squadPicklistOption(
  team: Pick<Team, 'id' | 'name' | 'description' | 'transport'>,
  { withDescription = false }: { withDescription?: boolean } = {}
): PopoverPicklistOption<string> {
  return {
    value: team.id,
    label: team.name,
    content: (
      <span className="squad-picklist-option" data-squad-transport={squadTransport(team)}>
        <span className="squad-picklist-option-name">{team.name}</span>
        <SquadTransportChip team={team} />
      </span>
    ),
    ...(withDescription && team.description ? { description: team.description } : {})
  };
}

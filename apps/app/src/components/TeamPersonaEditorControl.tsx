import { useState } from 'react';
import type { Team } from '@zana-ai/zcc-domain/product';
import { usePersonas } from '../store.js';
import { PersonaEditor } from './PersonaEditor.js';

/** Edits persisted member personas; teams only retain persona references, never per-slot overrides. */
export function TeamPersonaEditorControl({ team, projectId }: { team: Team | undefined; projectId?: string }) {
  const personas = usePersonas((state) => state.personas);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const persona = personaId ? personas.find((entry) => entry.id === personaId) : undefined;
  if (!team?.slots.length) return null;

  return (
    <>
      <div className="thread-command-chip" data-testid="team-member-personas">
        <span>Members</span>
        {team.slots.map((slot, index) => {
          const member = personas.find((entry) => entry.id === slot.personaId);
          return (
            <button
              key={`${slot.personaId}-${index}`}
              type="button"
              className="launch-advanced-toggle"
              onClick={() => setPersonaId(slot.personaId)}
              title={`Edit ${member?.name ?? slot.personaId}`}
            >
              {slot.label || member?.name || slot.personaId}
            </button>
          );
        })}
      </div>
      {persona ? (
        <PersonaEditor persona={persona} mode="edit" projectId={projectId} onClose={() => setPersonaId(null)} />
      ) : null}
    </>
  );
}

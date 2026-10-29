import { useEffect } from 'react';
import { useAgentScriptDoc } from '../agent-doc/useAgentScriptDoc.js';

/** A pinned tool observes the original agent's shared draft without moving the editor or taking its lease. */
export function PinnedToolSource({ pluginId, projectId, path, ready, onSource, onOpen }: {
  pluginId: string; projectId?: string; path: string; ready: boolean;
  onSource(path: string, source: string): void; onOpen(path: string): void;
}) {
  const document = useAgentScriptDoc(pluginId, projectId ?? null, path);
  useEffect(() => { if (typeof document.doc?.text === 'string') onSource(path, document.doc.text); }, [document.doc?.text, path, onSource]);
  if (ready) return null;
  return <div className="sf-as-banner" role="status">
    {document.error || (document.doc?.tooLarge ? 'Open this agent to load its script.' : 'Loading this agent’s draft…')}
    {(document.error || document.doc?.tooLarge) && <button type="button" className="sf-as-save" onClick={() => onOpen(path)}>Open agent</button>}
  </div>;
}

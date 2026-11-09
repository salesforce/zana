import './AgentSoundSettings.css';
import { useEffect, useState } from 'react';
import type { AgentSoundFilesSelection, AgentSoundKind, AppConfig } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';
import { CheckboxField, Field, Section } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';

const EVENTS = [
  { kind: 'done', key: 'agentSoundDone', searchId: 'agents.sound-done', label: 'Agent finishes a turn', preview: 'Finished turn', help: 'When the agent reports a completed turn. This does not verify the result.' },
  { kind: 'needs-you', key: 'agentSoundNeedsYou', searchId: 'agents.sound-needs-you', label: 'Agent needs you', preview: 'Needs you', help: 'When an agent requests your input or approval.' },
  { kind: 'idle', key: 'agentSoundIdle', searchId: 'agents.sound-idle', label: 'Agent becomes idle', preview: 'Idle', help: 'After five seconds at rest following work. Idle does not confirm a completed turn.' }
] as const;

export function AgentSoundSettings({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const [files, setFiles] = useState<AgentSoundFilesSelection>({});
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const api = typeof window !== 'undefined' ? window.cc?.app : undefined;
  const previewAvailable = !!api?.previewAgentSound;
  const importAvailable = !!api?.getAgentSoundFiles && !!api.chooseAgentSoundFile && !!api.clearAgentSoundFile;
  const spacing = config.agentSoundSpacingSeconds ?? 2;
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!api?.getAgentSoundFiles) { setLoading(false); return; }
      void api.getAgentSoundFiles().then(value => { if (alive) { setFiles(value); setError(''); } })
        .catch(() => { if (alive) setError('Could not load your audio choices. Reopen Settings to try again.'); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load(); window.addEventListener('focus', load);
    return () => { alive = false; window.removeEventListener('focus', load); };
  }, [api]);

  async function choose(kind: AgentSoundKind, value: string) {
    if (value === 'custom') return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (value === 'choose') {
        const file = await api!.chooseAgentSoundFile!(kind);
        if (file) { setFiles(previous => ({ ...previous, [kind]: file })); setMessage(`${file.name} saved. Notification switches have not changed.`); }
      } else {
        await api!.clearAgentSoundFile!(kind);
        setFiles(previous => { const next = { ...previous }; delete next[kind]; return next; });
        setMessage('Default chime restored.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this audio file. Your previous sound is still selected.'); }
    finally { setBusy(false); }
  }

  async function preview(kind: AgentSoundKind, label: string) {
    setBusy(true); setError(''); setMessage('');
    try { await api!.previewAgentSound!(kind); setMessage(`${label} preview played.`); }
    catch { setError('Could not play this sound. Try another audio file or the default chime.'); }
    finally { setBusy(false); }
  }

  const eventRow = (event: typeof EVENTS[number]) => <div key={event.kind} className="agent-sound-event">
    <CheckboxField label={event.label} searchId={event.searchId}
      help={event.help} checked={config[event.key] === true} onChange={value => void onUpdate({ [event.key]: value })} />
    <div className="agent-sound-event-controls">
      <PopoverPicklist ariaLabel={`${event.label} sound`} searchable={false} disabled={!importAvailable || loading || busy}
        value={files[event.kind] ? 'custom' : 'default'} onChange={value => void choose(event.kind, value)}
        options={[
          { value: 'default', label: 'Default chime' },
          ...(files[event.kind] ? [{ value: 'custom', label: files[event.kind]!.name }] : []),
          { value: 'choose', label: 'Choose audio file…', sticky: true }
        ]} />
      <button type="button" className="btn" disabled={!previewAvailable || loading || busy}
        aria-label={`Preview ${event.preview}`} onClick={() => void preview(event.kind, event.preview)}>▷ Preview</button>
    </div>
  </div>;

  return <Section anchorId="builtin-chimes" searchId="agents.agent-sounds.intro" title="Sounds by event"
    help="Use the built-in chimes or choose your own audio. No plugin needed.">
    <div data-settings-target="agents.sound-preview">{EVENTS.slice(0, 2).map(eventRow)}</div>
    <div className="agent-sound-options">
      <Field label="Volume" searchId="agents.sound-volume" help="Relative to system volume. Zero mutes notification audio.">
        <span className="agent-sound-volume">
          <input type="range" aria-label="Chime volume" min={0} max={100} step={1}
            value={normalizeAgentSoundVolume(config.agentSoundVolume)}
            onChange={event => void onUpdate({ agentSoundVolume: Number(event.target.value) })} />
          <span>{normalizeAgentSoundVolume(config.agentSoundVolume)}%</span>
        </span>
      </Field>
      <Field label="Quiet spacing" searchId="agents.sound-spacing" help="Keep a busy fleet quiet. Input requests take priority.">
        <PopoverPicklist ariaLabel="Quiet spacing" searchable={false} value={String(spacing)}
          options={[...new Set([2, 5, 10, 15, 30, 60, spacing])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value} seconds` }))}
          onChange={value => void onUpdate({ agentSoundSpacingSeconds: Number(value) })} />
      </Field>
    </div>
    <details className="agent-sound-idle" open={config.agentSoundIdle === true || window.location.hash.includes('sound-idle') || undefined}>
      <summary>Also notify when an agent becomes idle</summary>
      {eventRow(EVENTS[2])}
    </details>
    <p className="settings-help">{importAvailable
      ? 'MP3, WAV, or OGG · Up to 1 MB · Plays up to 8 seconds. Files are copied to this computer.'
      : previewAvailable ? 'Update Zana to choose your own audio files here.' : 'Sound playback and audio file selection are available in the Zana desktop app.'}</p>
    {error && <p role="alert" className="settings-help">{error}</p>}
    <p role="status" className="settings-help">{message}</p>
  </Section>;
}

import './AgentSoundSettings.css';
import { useState } from 'react';
import type { AgentSoundKind, AppConfig } from '@zana-ai/zcc-domain/product';
import { normalizeAgentSoundVolume } from '@zana-ai/zcc-domain/product';
import { CheckboxField, Field, Section, SettingsActionRow } from '@/components/settings/FormFields';

export function AgentSoundSettings({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const previewAvailable = typeof window !== 'undefined' && !!window.cc?.app?.previewAgentSound;
  async function preview(kind: AgentSoundKind) {
    try {
      await window.cc.app.previewAgentSound!(kind);
      setMessage(`${kind === 'idle' ? 'Idle' : 'Needs you'} preview played.`);
    } catch {
      setMessage('Could not play the preview. Try again.');
    }
  }
  return <Section anchorId="agent-sounds" searchId="agents.agent-sounds.intro" title="Notification sounds"
    help="Chimes on this computer for visible agents, even when Zana is in the background. Off by default.">
    <CheckboxField label="Play a chime when an agent needs you" searchId="agents.sound-needs-you"
      help="When an agent requests your input or approval."
      checked={config.agentSoundNeedsYou === true} onChange={value => onUpdate({ agentSoundNeedsYou: value })} />
    <CheckboxField label="Play a chime when an agent becomes idle" searchId="agents.sound-idle"
      help="After five seconds idle following work. Brief pauses stay quiet."
      checked={config.agentSoundIdle === true} onChange={value => onUpdate({ agentSoundIdle: value })} />
    <Field label="Chime volume" searchId="agents.sound-volume" help="Relative to your system volume. Zero mutes both chimes.">
      <span className="agent-sound-volume">
        <input type="range" aria-label="Chime volume" min={0} max={100} step={1}
          value={normalizeAgentSoundVolume(config.agentSoundVolume)}
          onChange={event => onUpdate({ agentSoundVolume: Number(event.target.value) })} />
        <span>{normalizeAgentSoundVolume(config.agentSoundVolume)}%</span>
      </span>
    </Field>
    <SettingsActionRow label="Preview sounds" searchId="agents.sound-preview" help={previewAvailable ? 'Try either chime without enabling notifications.' : 'Sound playback is available in the Zana desktop app.'}>
      <div className="agent-sound-preview-actions">
        <button type="button" className="btn" disabled={!previewAvailable} onClick={() => void preview('needs-you')}>Preview Needs you</button>
        <button type="button" className="btn" disabled={!previewAvailable} onClick={() => void preview('idle')}>Preview Idle</button>
      </div>
    </SettingsActionRow>
    <p role="status" className="settings-help">{message}</p>
  </Section>;
}

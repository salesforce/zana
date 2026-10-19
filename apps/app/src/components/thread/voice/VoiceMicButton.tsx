import type { ReactNode } from 'react';
import { Mic } from 'lucide-react';
import { ComposerIconButton } from '../../ui/CommandComposer.js';
import type { useVoiceInput } from './useVoiceInput.js';

type Voice = ReturnType<typeof useVoiceInput>;

/**
 * The composer mic. Renders nothing while dictation is off in
 * Settings → Experimental; otherwise stays disabled with the specific reason
 * as tooltip and accessible name. The tooltip lives on the wrapper because a
 * disabled button gets no hover of its own.
 */
export function VoiceMicButton({ voice, children }: { voice: Voice; children?: ReactNode }) {
  if (!voice.visible) return null;
  const label = voice.blockReason ?? 'Start voice input';
  return (
    <span className="composer-control-tooltip" data-tooltip={label}>
      <ComposerIconButton
        className="voice-input-btn voice-input-btn--icon"
        aria-label={label}
        disabled={!voice.canStart}
        onClick={() => void voice.start()}
      >
        <Mic size={14} />
        {children}
      </ComposerIconButton>
    </span>
  );
}

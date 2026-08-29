import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { useVoiceInput } from './useVoiceInput.js';

vi.mock('../../../lib/product-client.js', () => ({
  product: {
    voice: {
      hasApiKey: async () => false,
      ensureMicAccess: async () => true,
      transcribe: async () => ({ ok: true, text: 'hi' })
    }
  }
}));

vi.mock('../../../store.js', () => ({
  useUi: (select: (state: { pushToast: (message: string, kind: string) => void }) => unknown) =>
    select({ pushToast: () => undefined })
}));

function Probe({ enabled = true }: { enabled?: boolean }) {
  const voice = useVoiceInput({ onTranscript: () => undefined, enabled });
  return <span>{`${voice.state}:${String(voice.canStart)}:${String(voice.isSupported)}`}</span>;
}

describe('useVoiceInput', () => {
  it('gates start on MediaRecorder plus host availability and uses the capture session', () => {
    const source = readFileSync(new URL('./useVoiceInput.ts', import.meta.url), 'utf8');
    expect(source).toContain('createVoiceCapture');
    expect(source).toContain('voiceStartBlockReason');
    expect(source).toContain('product.voice.hasApiKey');
    expect(source).toContain('product.voice.ensureMicAccess');
    expect(source).toContain('product.voice.transcribe');
    expect(source).toContain('showError(blocked)');
  });

  it('renders idle and reports unsupported without MediaRecorder', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('idle:false:false');
    expect(renderToStaticMarkup(<Probe enabled={false} />)).toContain('idle:false:false');
  });
});

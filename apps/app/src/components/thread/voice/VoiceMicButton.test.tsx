import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceMicButton } from './VoiceMicButton.js';

const voice = (over: Record<string, unknown> = {}) => ({
  visible: true, blockReason: null, canStart: true, start: vi.fn(), ...over
}) as unknown as Parameters<typeof VoiceMicButton>[0]['voice'];

describe('VoiceMicButton', () => {
  it('renders nothing while dictation is off in Experimental', () => {
    expect(renderToStaticMarkup(<VoiceMicButton voice={voice({ visible: false })} />)).toBe('');
  });

  it('is enabled with the start label when voice can start', () => {
    const html = renderToStaticMarkup(<VoiceMicButton voice={voice()} />);
    expect(html).toContain('data-tooltip="Start voice input"');
    expect(html).toContain('aria-label="Start voice input"');
    expect(html).not.toContain('disabled');
  });

  it('is disabled and explains why on the wrapper tooltip and accessible name', () => {
    const html = renderToStaticMarkup(
      <VoiceMicButton voice={voice({ blockReason: 'Host daemon is not connected', canStart: false })} />
    );
    expect(html).toContain('data-tooltip="Host daemon is not connected"');
    expect(html).toContain('aria-label="Host daemon is not connected"');
    expect(html).toContain('disabled');
  });

  it('renders extra content such as the toolbar text label', () => {
    expect(renderToStaticMarkup(<VoiceMicButton voice={voice()}><b>Voice input</b></VoiceMicButton>)).toContain('<b>Voice input</b>');
  });
});

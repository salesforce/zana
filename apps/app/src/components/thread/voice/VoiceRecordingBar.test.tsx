// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecordingBar } from './VoiceRecordingBar.js';

vi.mock('./waveform.js', () => ({ startWaveform: () => () => undefined }));
afterEach(cleanup);

describe('recording send controls', () => {
  it('sends an available recording and keeps transcription separate', () => {
    const onSend = vi.fn(), onConfirm = vi.fn(), onCancel = vi.fn();
    render(<VoiceRecordingBar state="recording" stream={null} onSend={onSend} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe recording' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('blocks send while busy and hides it during transcription or without a send handler', () => {
    const onSend = vi.fn(), onConfirm = vi.fn(), onCancel = vi.fn();
    const view = render(<VoiceRecordingBar state="recording" stream={null} sendDisabled onSend={onSend} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Transcribe and send recording' }));
    expect(onSend).not.toHaveBeenCalled();
    view.rerender(<VoiceRecordingBar state="transcribing" stream={null} onSend={onSend} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Transcribe and send recording' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Transcribing voice input' }).hasAttribute('disabled')).toBe(true);
    view.rerender(<VoiceRecordingBar state="recording" stream={null} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole('button', { name: 'Transcribe and send recording' })).toBeNull();
  });
});

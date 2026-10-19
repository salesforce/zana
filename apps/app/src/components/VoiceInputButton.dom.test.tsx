// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(), refresh: vi.fn(), transcribe: vi.fn(),
  availability: { state: 'ready', reason: null } as { state: string; reason: string | null },
  recorder: null as any
}));
vi.mock('../lib/product-client.js', () => ({
  product: { voice: { ensureMicAccess: async () => true, transcribe: mocks.transcribe } }
}));
vi.mock('./thread/voice/voice-status-store.js', () => ({
  useVoiceAvailability: () => ({ enabled: true, availability: mocks.availability }),
  useVoiceStatus: { getState: () => ({ refresh: mocks.refresh }) }
}));
vi.mock('../store.js', () => ({ useUi: (select: any) => select({ pushToast: mocks.toast }) }));

class FakeRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void | Promise<void>) | null = null;
  constructor() { mocks.recorder = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; void this.onstop?.(); }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.availability = { state: 'ready', reason: null };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) }
  });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  // jsdom's Blob has no arrayBuffer().
  Blob.prototype.arrayBuffer = async () => new ArrayBuffer(4);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('no audio'); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function load() {
  const { VoiceInputButton } = await import('./VoiceInputButton.js');
  const ui = () => <VoiceInputButton value="" onChange={vi.fn()} onTranscript={vi.fn()} />;
  return { ui, view: render(ui()) };
}

it('keeps Stop enabled when availability flips during recording, and disables Start otherwise', async () => {
  const { ui, view } = await load();
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('button').className).toContain('is-recording'));
  mocks.availability = { state: 'unavailable', reason: 'auth_missing' };
  view.rerender(ui());
  const button = screen.getByRole('button') as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  mocks.transcribe.mockResolvedValue({ ok: true, text: 'hi', error: '' });
  fireEvent.click(button);
  await waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
  await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByRole('button').getAttribute('aria-label')).toContain('codex login');
});

it('re-checks host readiness when transcription fails (thrown or reported)', async () => {
  await load();
  mocks.transcribe.mockRejectedValueOnce(new Error('boom'));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('button').className).toContain('is-recording'));
  await act(async () => { mocks.recorder.stop(); });
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Transcription failed: boom', 'error'));
  expect(mocks.refresh).toHaveBeenCalledTimes(1);

  mocks.transcribe.mockResolvedValueOnce({ ok: false, text: '', error: 'login needed' });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('button').className).toContain('is-recording'));
  await act(async () => { mocks.recorder.stop(); });
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('login needed', 'error'));
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

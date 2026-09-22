/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { PhoneTab } from './PhoneSettingsView.js';

const mobile = {
  status: vi.fn(),
  pair: vi.fn(),
  devices: vi.fn(),
  revoke: vi.fn()
};

vi.mock('../../lib/product-client.js', () => ({
  product: {
    get mobile() {
      return mobile;
    }
  }
}));

// happy-dom has no canvas — stub the QR renderer to a deterministic data URL.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,QRSTUB') }
}));

const baseConfig = (patch: Partial<AppConfig> = {}): AppConfig => ({
  version: 1,
  theme: 'system',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null,
  ...patch
});

const runningStatus = {
  running: true,
  publicUrl: 'http://192.168.1.42:8785',
  host: '192.168.1.42',
  port: 8785,
  boundLan: true,
  error: null
};

beforeEach(() => {
  mobile.status.mockResolvedValue({ running: false, publicUrl: null, host: null, port: null, boundLan: false, error: null });
  mobile.devices.mockResolvedValue([]);
  mobile.pair.mockResolvedValue({
    version: 1,
    serverUrl: 'http://192.168.1.42:8785',
    code: 'abc123def456ghi789jkl0',
    expiresAt: Date.now() + 5 * 60_000
  });
  mobile.revoke.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PhoneTab', () => {
  it('persists the enable toggle through onUpdate', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      render(<PhoneTab config={baseConfig()} onConfigDraft={vi.fn()} onUpdate={onUpdate} />);
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable phone access' }));
    expect(onUpdate).toHaveBeenCalledWith({ mobileGatewayEnabled: true });
  });

  it('shows the trusted-network caveat when bound to a LAN address', async () => {
    mobile.status.mockResolvedValue(runningStatus);
    await act(async () => {
      render(
        <PhoneTab config={baseConfig({ mobileGatewayEnabled: true })} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
      );
    });
    await waitFor(() => expect(screen.getByText(/trusted network/i)).toBeTruthy());
    expect(screen.getByText(/192\.168\.1\.42:8785/)).toBeTruthy();
  });

  it('renders a QR image and the pairing code after pairing', async () => {
    mobile.status.mockResolvedValue(runningStatus);
    await act(async () => {
      render(
        <PhoneTab config={baseConfig({ mobileGatewayEnabled: true })} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
      );
    });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Show pairing QR' }) as HTMLButtonElement).disabled).toBe(false)
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show pairing QR' }));
    });
    await waitFor(() => expect(screen.getByAltText('Zana Mobile pairing QR code')).toBeTruthy());
    const img = screen.getByAltText('Zana Mobile pairing QR code') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,QRSTUB');
    expect(mobile.pair).toHaveBeenCalledTimes(1);
    expect(screen.getByText('abc123def456ghi789jkl0')).toBeTruthy();
  });

  it('revokes a paired device', async () => {
    mobile.status.mockResolvedValue(runningStatus);
    mobile.devices.mockResolvedValue([{ id: 'd1', label: 'My iPhone', createdAt: 0, expiresAt: Date.now() + 1e9 }]);
    await act(async () => {
      render(
        <PhoneTab config={baseConfig({ mobileGatewayEnabled: true })} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />
      );
    });
    await waitFor(() => expect(screen.getByText('My iPhone')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Revoke My iPhone' }));
    });
    expect(mobile.revoke).toHaveBeenCalledWith('d1');
  });
});

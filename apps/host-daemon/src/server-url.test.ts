import { describe, expect, it } from 'vitest';
import { joinServerUrl, joinServerWsUrl } from './server-url.js';

const PAIRING = 'https://zcc-7808c5bc8f3d.herokuapp.com/t/zcrs_Yx43jhn5KtFfD-skzt53KdyZ';

describe('joinServerUrl', () => {
  it('keeps the pairing session prefix', () => {
    expect(joinServerUrl(PAIRING, '/internal/hosts/enroll').href).toBe(
      `${PAIRING}/internal/hosts/enroll`
    );
    expect(joinServerWsUrl(PAIRING, '/internal/hosts/ws').href).toBe(
      'wss://zcc-7808c5bc8f3d.herokuapp.com/t/zcrs_Yx43jhn5KtFfD-skzt53KdyZ/internal/hosts/ws'
    );
  });

  it('joins loopback origins the same way as a leading-slash URL', () => {
    expect(joinServerUrl('http://127.0.0.1:8780', '/internal/hosts/enroll').href).toBe(
      'http://127.0.0.1:8780/internal/hosts/enroll'
    );
    expect(joinServerUrl('http://127.0.0.1:8780/', '/api/v1/health').href).toBe(
      'http://127.0.0.1:8780/api/v1/health'
    );
  });

  it('documents that a leading-slash URL drops /t/<session>', () => {
    expect(new URL('/internal/hosts/enroll', PAIRING).href).toBe(
      'https://zcc-7808c5bc8f3d.herokuapp.com/internal/hosts/enroll'
    );
  });
});

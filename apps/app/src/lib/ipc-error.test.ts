import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';
import { expect, it } from 'vitest';
import { ipcErrorMessage, isConnectAccessRevoked } from './ipc-error.js';

it('strips the Electron IPC wrapper and falls back when nothing is left', () => {
  expect(ipcErrorMessage(new Error("Error invoking remote method 'mobile:browserAddress': Error: Boom"), 'x')).toBe('Boom');
  expect(ipcErrorMessage(new Error('Plain'), 'x')).toBe('Plain');
  expect(ipcErrorMessage('string failure', 'x')).toBe('x');
  expect(ipcErrorMessage(undefined, 'fallback')).toBe('fallback');
  expect(ipcErrorMessage(new Error(''), 'fallback')).toBe('fallback');
});
it('classifies revoked credentials by the stable main message, wrapped or not', () => {
  expect(isConnectAccessRevoked(new Error(`Error invoking remote method 'm': Error: ${CONNECT_ACCESS_REVOKED_MESSAGE}`))).toBe(true);
  expect(isConnectAccessRevoked(new Error('Connect returned 500.'))).toBe(false);
  expect(isConnectAccessRevoked(null)).toBe(false);
});

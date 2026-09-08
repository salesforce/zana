import { app } from 'electron';
import { join } from 'node:path';

// Electron ignores HOME for app.getPath('home') on macOS. Set the app path
// before loading the main module, whose storage modules resolve it at import time.
const e2eHome = process.env.ZCC_E2E_HOME;
if (e2eHome) {
  app.setPath('home', e2eHome);
  // NOTE: the durable-launch safeStorage/Keychain problem is NOT solved here.
  // `--password-store=basic` is a Linux-only switch — macOS always uses the
  // Keychain backend, and `safeStorage.isEncryptionAvailable()` BLOCKS the main
  // thread forever on a headless runner (no Keychain session). The real fix is
  // the resume-token store's `insecure` mode, enabled from ZCC_E2E_HOME in
  // host.ts, which bypasses safeStorage entirely under E2E.
}

// Unpackaged `pnpm dev` shares the packaged app's userData (`Zana`) unless we
// pin it under ZCC_DATA_DIR. E2E already passes `--user-data-dir`.
const dataDir = process.env.ZCC_DATA_DIR?.trim();
if (!e2eHome && dataDir && !app.isPackaged) {
  app.setPath('userData', join(dataDir, 'electron-user-data'));
}

void import('./main.js');

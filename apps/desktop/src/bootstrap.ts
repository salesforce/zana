import { app } from 'electron';
import { join } from 'node:path';

// Electron ignores HOME for app.getPath('home') on macOS. Set the app path
// before loading the main module, whose storage modules resolve it at import time.
const e2eHome = process.env.ZCC_E2E_HOME;
if (e2eHome) {
  app.setPath('home', e2eHome);
  // `--password-store=basic` is a Linux-only switch — macOS always uses the
  // Keychain backend for app-level safeStorage calls, which the resume-token
  // store's `insecure` mode (enabled from ZCC_E2E_HOME in host.ts) bypasses.
  // But Chromium's OWN os_crypt (cookie/local-storage encryption) touches the
  // real macOS Keychain at boot regardless of app code, prompting an
  // interactive "wants to access key in your keychain" dialog with no one to
  // click Allow on a headless runner. `use-mock-keychain` is the cross-platform
  // Chromium switch for exactly this (must be set before app ready).
  app.commandLine.appendSwitch('use-mock-keychain');
}

// Unpackaged `pnpm dev` shares the packaged app's userData (`Zana`) unless we
// pin it under ZCC_DATA_DIR. E2E already passes `--user-data-dir`.
const dataDir = process.env.ZCC_DATA_DIR?.trim();
if (!e2eHome && dataDir && !app.isPackaged) {
  app.setPath('userData', join(dataDir, 'electron-user-data'));
}

void import('./main.js');

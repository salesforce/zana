import { app } from 'electron';

// Electron ignores HOME for app.getPath('home') on macOS. Set the app path
// before loading the main module, whose storage modules resolve it at import time.
const e2eHome = process.env.ZCC_E2E_HOME;
if (e2eHome) app.setPath('home', e2eHome);

void import('./index.js');

/**
 * Desktop-owned Electron main-process entry (electron-vite `input.main`).
 * Product IPC, PTY, and inbox authority live in `./host.ts` until those
 * slices move behind the runtime supervisor. Bootstrap sets HOME, then
 * loads this graph.
 */
import './host.js';

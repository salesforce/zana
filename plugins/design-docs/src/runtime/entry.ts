// Bundled into page-runtime.js, which each rendered page loads ahead of its own scripts.
import { startPageRuntime } from './page-runtime.js';

if (!('__ddPage' in window)) startPageRuntime(window);
document.currentScript?.remove();

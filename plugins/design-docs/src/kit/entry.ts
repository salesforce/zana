// Bundled into kit/site.js. Load it in the page's <head> so the reader's theme applies before the page paints.
import { createKit } from './index.js';

const kit = createKit(window);
Object.defineProperty(window, 'Kit', { value: kit, configurable: true });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => kit.enhance(), { once: true });
else kit.enhance();

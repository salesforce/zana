/**
 * The first-run GitHub star nudge must mount in the main shell only.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RENDERER_ROOT = fileURLToPath(new URL('..', import.meta.url));

function src(rel: string): string {
  return readFileSync(join(RENDERER_ROOT, rel), 'utf8');
}

describe('SponsorNudge shell mount', () => {
  it('App.tsx mounts SponsorNudge only when the window is not project-scoped', () => {
    const app = src('App.tsx');
    expect(app).toMatch(/import \{ SponsorNudge \} from '\.\/components\/SponsorNudge\.js'/);
    expect(app).toMatch(/\{!isScopedWindow\(\) && <SponsorNudge \/>\}/);
  });

  it('shell CSS gives the nudge its own row without the status strip', () => {
    const css = src('styles/global.css');
    expect(css).toContain('.app-shell:has(.sponsor-nudge) {\n  grid-template-rows: var(--titlebar-h) 1fr auto;\n}');
    expect(css).toContain(
      '.app-shell.has-update-banner:has(.sponsor-nudge) {\n  grid-template-rows: var(--titlebar-h) auto 1fr auto;\n}'
    );
    expect(css).not.toContain('.app-shell.has-statusbar:has(.sponsor-nudge)');
  });
});

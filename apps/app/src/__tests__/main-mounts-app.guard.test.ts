import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer always mounts App in the browser', () => {
  const source = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');

  it('does not fork to the local-preview card when the desktop bridge is absent', () => {
    expect(source).not.toMatch(/BrowserAccess/);
    expect(source).toMatch(/hasDesktopBridge/);
    expect(source).toMatch(/import\('\.\/App\.js'\)/);
    expect(source).toMatch(/BrowserRouter/);
  });
});

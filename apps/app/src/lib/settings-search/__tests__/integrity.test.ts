import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getStaticEntries } from '../registry';
import { findSecretValueViolations } from '../secrets';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sources(full);
    return /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [full] : [];
  });
}

describe('settings-search integrity (final review)', () => {
  it('has unique entry ids across every page', () => {
    const seen = new Map<string, number>();
    for (const e of getStaticEntries()) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it('defines no value accessor on a secret-looking static entry', () => {
    expect(findSecretValueViolations(getStaticEntries())).toEqual([]);
  });

  it('keeps the rail light: the index imports no settings view or heavy panel', () => {
    const offenders = sources(DIR).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1])
        // Views/components may be imported only as the nav registry, never a *View/*Section module.
        .filter((spec) => /views\/settings\/(?!settings-navigation)/.test(spec) || /\/ExtensionsHub|\/SettingsView/.test(spec))
        .map((spec) => `${file.slice(DIR.length)}: ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it('never uses a bare module-id string literal in the index (Rule 6)', () => {
    const bare = sources(DIR).filter((f) => /(['"])zana\1/.test(readFileSync(f, 'utf8')));
    expect(bare).toEqual([]);
  });
});

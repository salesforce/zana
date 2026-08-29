import { basename, join } from 'node:path';
import type { SalesforceDeps } from './types.js';
import { listFilesRecursive, parsePackageDirectories, resolveUnderRoot } from './dx-project.js';

export type LwcAction = 'scan' | 'inspect' | 'diagnose' | 'test.jest';

export interface LwcInput {
  action?: string;
  component?: string;
  relativePath?: string;
}

export interface LwcComponent {
  name: string;
  dir: string;
  hasHtml: boolean;
  hasJs: boolean;
  hasCss: boolean;
  hasMeta: boolean;
}

const ACTIONS: readonly LwcAction[] = ['scan', 'inspect', 'diagnose', 'test.jest'];

export function parseLwcInput(input: unknown): { ok: true; action: LwcAction; component?: string; relativePath?: string } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' ? (input as LwcInput) : {};
  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!ACTIONS.includes(action as LwcAction)) {
    return { ok: false, error: `Unknown sf_lwc action. Use ${ACTIONS.join(', ')}. Deploy/retrieve/create are not offered.` };
  }
  const component = typeof raw.component === 'string' ? raw.component.trim() : '';
  const relativePath = typeof raw.relativePath === 'string' ? raw.relativePath.trim() : '';
  if ((action === 'inspect' || action === 'diagnose' || action === 'test.jest') && !component && !relativePath) {
    return { ok: false, error: `${action} requires component or relativePath.` };
  }
  return {
    ok: true,
    action: action as LwcAction,
    component: component || undefined,
    relativePath: relativePath || undefined
  };
}

export function scanLwcComponents(projectRoot: string, deps: SalesforceDeps): LwcComponent[] {
  const manifest = deps.readFile(join(projectRoot, 'sfdx-project.json')) ?? '{}';
  const packages = parsePackageDirectories(manifest);
  const found: LwcComponent[] = [];
  for (const pkg of packages) {
    const pkgRoot = resolveUnderRoot(projectRoot, pkg, deps.realpath);
    if (!pkgRoot) continue;
    const files = listFilesRecursive(pkgRoot, deps);
    const metaFiles = files.filter(
      (file) => file.endsWith('.js-meta.xml') && (file.includes('/lwc/') || file.includes('\\lwc\\'))
    );
    for (const meta of metaFiles) {
      const dir = meta.slice(0, meta.length - '.js-meta.xml'.length);
      const name = basename(dir);
      found.push({
        name,
        dir,
        hasHtml: deps.exists(`${dir}.html`),
        hasJs: deps.exists(`${dir}.js`),
        hasCss: deps.exists(`${dir}.css`),
        hasMeta: true
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function findLwcComponent(
  components: LwcComponent[],
  component?: string,
  relativePath?: string
): LwcComponent | null {
  if (component) {
    const match = components.find((row) => row.name === component);
    if (match) return match;
  }
  if (relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return components.find((row) => row.dir.replace(/\\/g, '/').endsWith(normalized) || row.name === basename(normalized)) ?? null;
  }
  return null;
}

export function diagnoseLwc(component: LwcComponent): string[] {
  const issues: string[] = [];
  if (!/^[a-z][a-zA-Z0-9]*$/.test(component.name)) {
    issues.push('Bundle folder should be camelCase starting with a lowercase letter.');
  }
  if (!component.hasJs) issues.push('Missing .js controller.');
  if (!component.hasHtml) issues.push('Missing .html template.');
  if (!component.hasMeta) issues.push('Missing .js-meta.xml.');
  return issues;
}

export function inspectLwc(component: LwcComponent, deps: SalesforceDeps): Record<string, unknown> {
  const js = deps.readFile(`${component.dir}.js`) ?? '';
  const html = deps.readFile(`${component.dir}.html`) ?? '';
  const apis = [...js.matchAll(/@api\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  return {
    name: component.name,
    dir: component.dir,
    files: {
      js: component.hasJs,
      html: component.hasHtml,
      css: component.hasCss,
      meta: component.hasMeta
    },
    publicApi: apis,
    jsChars: js.length,
    htmlChars: html.length
  };
}

export function resolveJestBin(projectRoot: string, deps: SalesforceDeps): string | null {
  const candidates = ['sfdx-lwc-jest', 'lwc-jest'];
  for (const name of candidates) {
    const bin = resolveUnderRoot(projectRoot, join('node_modules', '.bin', name), deps.realpath);
    if (bin && deps.stat(bin) !== 'missing') return bin;
  }
  return null;
}

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { confine } from '../projects/fs.js';

const PLAN_DIR_SEGMENTS = ['.zcc', 'plans'] as const;
const HEADING_RE = /^#{1,6}\s+(\S.*)$/m;
export const PLAN_DRAFT_MIN_LENGTH = 200;

export function isSubstantialPlanDraft(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return trimmed.length >= PLAN_DRAFT_MIN_LENGTH || /^#{1,6}\s+\S/m.test(trimmed);
}

export function planFileSlug(markdown: string, fallbackId: string): string {
  const heading = markdown.match(HEADING_RE)?.[1]?.trim() ?? '';
  const fromHeading = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const fromId = fallbackId.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24);
  return fromHeading || fromId || 'plan';
}

export function writeThreadPlanFile(args: {
  projectRoot: string;
  markdown: string;
  fallbackId: string;
  existingPath?: string | null;
}): string | null {
  const confinedRoot = confine(args.projectRoot, args.projectRoot);
  if (!confinedRoot.ok) return null;
  const plansDir = join(confinedRoot.path, ...PLAN_DIR_SEGMENTS);
  const confinedDir = confine(confinedRoot.path, plansDir);
  if (!confinedDir.ok) return null;
  const dest = resolvePlanDest({
    projectRoot: confinedRoot.path,
    plansDir: confinedDir.path,
    markdown: args.markdown,
    fallbackId: args.fallbackId,
    existingPath: args.existingPath
  });
  if (!dest) return null;
  try {
    if (existsSync(dest) && readFileSync(dest, 'utf8') === args.markdown) return dest;
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(dest), `.${basename(dest)}.tmp.${randomUUID()}`);
    writeFileSync(tmp, args.markdown, { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(tmp, dest);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* best-effort */ }
      throw error;
    }
    return dest;
  } catch {
    return null;
  }
}

function resolvePlanDest(args: {
  projectRoot: string;
  plansDir: string;
  markdown: string;
  fallbackId: string;
  existingPath?: string | null;
}): string | null {
  if (args.existingPath) {
    const confined = confine(args.projectRoot, args.existingPath);
    if (confined.ok) return confined.path;
  }
  const dest = join(args.plansDir, `${planFileSlug(args.markdown, args.fallbackId)}.plan.md`);
  const confined = confine(args.projectRoot, dest);
  return confined.ok ? confined.path : null;
}

/** True when dest is a markdown plan file confined under `<workspace>/.zcc/plans`. */
export function isPlanArtifactPath(workspaceRoot: string, dest: string): boolean {
  const confinedRoot = confine(workspaceRoot, workspaceRoot);
  if (!confinedRoot.ok) return false;
  const plansDir = join(confinedRoot.path, ...PLAN_DIR_SEGMENTS);
  const confinedPlans = confine(confinedRoot.path, plansDir);
  if (!confinedPlans.ok) return false;
  const confinedDest = confine(confinedPlans.path, dest);
  if (!confinedDest.ok) return false;
  return basename(confinedDest.path).toLowerCase().endsWith('.md');
}

import { launchDigest } from '../launch/digest.js';
import { parsePortablePlan, type PortablePlanWorkUnitInput } from './portable-plan.js';

/**
 * Canonical text: the parsed steps re-rendered in the Squad plan grammar with every normalization applied, so
 * it is the plan the Squad will run rather than the text the user typed. Display only: it is never mixed into
 * `launchDigest`, and the approval digest is always computed from the parsed work units.
 *
 * The renderer is deterministic (fixed label order, no timestamps). It verifies itself: the rendered text must
 * parse back to work units with the same launch digest, otherwise nothing is returned and the caller shows no
 * canonical text rather than text that would run differently.
 */

const LEVEL_CLASS: Readonly<Record<string, string>> = { low: 'Routine', medium: 'Standard', high: 'Expert' };
const COMPLETION_PREFIX = 'Completion criteria: ';

function value(text: string): string {
  return text.trim() ? text : 'None';
}

function renderRequires(requires: NonNullable<PortablePlanWorkUnitInput['requires']>): string | undefined {
  const parts = [
    requires.skills?.length ? `Skills: ${requires.skills.join(', ')}` : '',
    requires.mcpServers?.length ? `MCP servers: ${requires.mcpServers.join(', ')}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}

function renderFailure(unit: PortablePlanWorkUnitInput): string[] {
  const policy = unit.onFailure;
  if (!policy) return [];
  if (policy.kind === 'fail-run') return ['- **On failure:** fail run'];
  return [
    `- **On failure:** retry ${policy.stepId} up to ${policy.maxRetries} with feedback`,
    ...(policy.maxIterations !== undefined ? [`- **maxIterations:** ${policy.maxIterations}`] : []),
    ...(policy.noProgressLimit !== undefined ? [`- **noProgressLimit:** ${policy.noProgressLimit}`] : [])
  ];
}

function renderStep(unit: PortablePlanWorkUnitInput): string {
  const routing = unit.routing;
  const completionText = unit.verification?.filter((entry) => entry.startsWith(COMPLETION_PREFIX)).pop();
  const verification = (unit.verification ?? []).filter((entry) => entry !== completionText);
  const completion = unit.checks?.length ? unit.checks.map((name) => `check:${name}`).join(', ') : completionText?.slice(COMPLETION_PREFIX.length);
  const requires = unit.requires ? renderRequires(unit.requires) : undefined;
  const lines = [
    `### ${unit.id}: ${unit.title} <!-- executable-step -->`,
    `- **Depends on:** ${value(unit.dependencies.join(', '))}`,
    ...(routing?.minimumLevel && LEVEL_CLASS[routing.minimumLevel] ? [`- **Execution class:** ${LEVEL_CLASS[routing.minimumLevel]}`] : []),
    ...(routing?.requiredRole ? [`- **Required role:** ${routing.requiredRole}`] : []),
    ...(routing?.preferRoles?.length ? [`- **Prefer role:** ${routing.preferRoles.join(', ')}`] : []),
    ...(routing?.excludeSameWorkerAs?.length ? [`- **Not same worker as:** ${routing.excludeSameWorkerAs.join(', ')}`] : []),
    ...(unit.readOnly ? ['- **Mode:** read-only'] : []),
    `- **Write scope:** ${value((unit.files ?? []).join(', '))}`,
    `- **Work:** ${unit.task}`,
    ...(verification.length ? [`- **Verification:** ${verification.join('\n')}`] : []),
    ...(completion ? [`- **Completion criteria:** ${completion}`] : []),
    ...(requires ? [`- **Requires:** ${requires}`] : []),
    ...renderFailure(unit),
    ...(unit.loop ? [`- **Loop:** ${unit.loop.fixUnitId} until PASS, max ${unit.loop.max}`] : [])
  ];
  return lines.join('\n');
}

/** Same units, as the launch would see them: undefined keys are dropped by `canonicalJson` inside the digest. */
function sameUnits(a: readonly unknown[], b: readonly unknown[]): boolean {
  return launchDigest(a) === launchDigest(b);
}

/**
 * The parsed steps in the Squad plan grammar, or undefined when there is nothing to show: no steps, text over
 * `maxBytes`, or text that does not parse back to the same work units (so the display could not lie).
 */
export function renderCanonicalPlan(
  units: readonly PortablePlanWorkUnitInput[],
  options: { declaredSquad?: string; maxBytes?: number } = {}
): string | undefined {
  if (!units.length) return undefined;
  const header = options.declaredSquad ? `## Launch\n- **Squad:** ${options.declaredSquad}\n\n` : '';
  const text = `${header}## Execution Plan\n\n${units.map(renderStep).join('\n\n')}\n`;
  if (options.maxBytes !== undefined && Buffer.byteLength(text, 'utf8') > options.maxBytes) return undefined;
  const reparsed = parsePortablePlan(text);
  if (!reparsed.ok || !sameUnits(reparsed.units, units)) return undefined;
  if ((reparsed.declaredSquad ?? undefined) !== (options.declaredSquad ?? undefined)) return undefined;
  return text;
}

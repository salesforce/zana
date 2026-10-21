import { isNamedMap, parse } from '@sf-agentscript/agentforce';
import { AGENT_SOURCE_MAX } from './studio-contract.js';
import { CONTEXT_LIMITS, type ContextType, type PreviewContextField } from './preview-context.js';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof record(v).value === 'string' ? record(v).value as string : undefined;

/** Uses the official AST, so comments, quoted blocks and internal variables never become inputs. */
export function discoverPreviewContext(source: string): PreviewContextField[] {
  if (source.length > AGENT_SOURCE_MAX) throw Error('Agent Script is too large to discover context variables.');
  const ast = record(parse(/@dialect\s*:/.test(source.slice(0, 400)) ? source : `# @dialect:agentforce\n${source}`).ast);
  return (isNamedMap(ast.variables) ? [...ast.variables.entries()] : []).flatMap(([name, node]) => {
    const variable = record(node), properties = record(variable.properties);
    const linked = record(variable.modifier).name === 'linked';
    if (!linked && text(properties.visibility)?.toLowerCase() !== 'external') return [];
    const expression = record(variable.type);
    const kind = expression.name ?? record(expression.object).name;
    const type: ContextType = kind === 'boolean' ? 'Boolean' : kind === 'number' ? 'Number' : kind === 'date' ? 'Date' : kind === 'object' ? 'Json' : kind === 'list' ? 'List' : kind === 'id' ? 'Ref' : 'Text';
    const sourceRef = record(properties.source);
    const sourceName = record(sourceRef.object).name;
    const origin = typeof sourceName === 'string' && typeof sourceRef.property === 'string' ? `@${sourceName}.${sourceRef.property}` : undefined;
    return [{ name: linked ? `$Context.${name}` : name, label: text(properties.label) ?? name, type,
      ...(text(properties.description) ? { description: text(properties.description) } : {}),
      ...(origin ? { source: origin } : {}),
      ...('value' in record(variable.defaultValue) ? { defaultValue: record(variable.defaultValue).value } : {}) }];
  }).slice(0, CONTEXT_LIMITS.count);
}

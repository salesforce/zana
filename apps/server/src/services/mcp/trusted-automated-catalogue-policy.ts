import { createHash } from 'node:crypto';
import { REMOTE_FS_TOOL_NAMES } from '@zana-ai/zcc-host-daemon/remote-fs-mcp-tools';
import { EXECUTION_MEMBER_TOOL_NAMES } from '../execution/execution-mcp-tool.js';

const REMOTE_CAPABILITY = 'remote_fs';
const REMOTE_TOOL_NAMES = [...REMOTE_FS_TOOL_NAMES, 'remote_exec'] as const;

export type TrustedAutomatedMcpRole = keyof typeof EXECUTION_MEMBER_TOOL_NAMES;
export type TrustedAutomatedMcpCapability = typeof REMOTE_CAPABILITY;

/**
 * Host-attested facts only. Do not derive these values from renderer state,
 * prompts, or model-supplied tool arguments.
 */
export interface TrustedAutomatedMcpCatalogueHostFacts {
  member?: {
    role: string;
    capabilities?: readonly string[];
  };
}

export interface TrustedAutomatedMcpCatalogue {
  /** No member fence means preserve the legacy, unrestricted catalogue path. */
  legacy: boolean;
  role?: TrustedAutomatedMcpRole;
  tools?: readonly string[];
  digest: string;
}

function immutableTools(names: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(names)]);
}

function isTrustedRole(role: string): role is TrustedAutomatedMcpRole {
  return Object.hasOwn(EXECUTION_MEMBER_TOOL_NAMES, role);
}

function digestFor(legacy: boolean, role: TrustedAutomatedMcpRole | undefined, tools: readonly string[] | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify({ legacy, role: role ?? null, tools: tools ? [...tools] : null }))
    .digest('hex');
}

/**
 * Select a member-fenced catalogue from trusted host facts. Legacy routes get
 * no replacement catalogue, so callers retain their existing legacy surface.
 */
export function trustedAutomatedMcpCatalogue(
  facts: TrustedAutomatedMcpCatalogueHostFacts
): TrustedAutomatedMcpCatalogue {
  if (!facts.member) {
    const digest = digestFor(true, undefined, undefined);
    return Object.freeze({ legacy: true, digest });
  }

  const role = facts.member.role;
  if (!isTrustedRole(role)) {
    throw new Error(`Unknown trusted automated MCP role: ${role}`);
  }

  const capabilities = facts.member.capabilities ?? [];
  for (const capability of capabilities) {
    if (capability !== REMOTE_CAPABILITY) {
      throw new Error(`Unknown trusted automated MCP capability: ${capability}`);
    }
  }

  const tools = immutableTools([
    ...EXECUTION_MEMBER_TOOL_NAMES[role],
    ...(capabilities.includes(REMOTE_CAPABILITY) ? REMOTE_TOOL_NAMES : [])
  ]);
  return Object.freeze({
    legacy: false,
    role,
    tools,
    digest: digestFor(false, role, tools)
  });
}

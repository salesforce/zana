import type { DoctorReport, PluginSettingsValues, SalesforceDeps } from './types.js';
import { isDxProject } from './dx-project.js';
import { publicOrgView } from './org-resolution.js';
import { parseCliVersion, parseOrgDisplay, parseOrgList } from './sf-cli.js';
import { ConnectionError } from './connection.js';
import { probeAgentCapabilities, scanAgentBundles } from './agent.js';

function emptyAgentFields() {
  return { agentCompiler: 'missing' as const, agentPluginOk: false, agentBundleCount: 0 };
}

async function agentDoctorFields(deps: SalesforceDeps, settings: PluginSettingsValues, cliOk: boolean) {
  const projectRoot = settings.projectRoot.trim();
  const dx = isDxProject(projectRoot, deps.exists);
  const bundles = dx ? scanAgentBundles(deps.realpath(projectRoot), deps) : [];
  if (!cliOk) {
    return { ...emptyAgentFields(), agentBundleCount: bundles.length };
  }
  const probed = await probeAgentCapabilities(dx ? deps.realpath(projectRoot) : '', deps);
  return {
    agentCompiler: probed.compiler,
    agentPluginOk: probed.pluginOk,
    agentBundleCount: bundles.length
  };
}

export async function runDoctor(
  deps: SalesforceDeps,
  settings: PluginSettingsValues
): Promise<DoctorReport> {
  const at = deps.now();
  const dxProject = isDxProject(settings.projectRoot, deps.exists);
  const version = await deps.execSf(['--version']);
  if (version.code === 127) {
    const agent = await agentDoctorFields(deps, settings, false);
    return {
      cliOk: false,
      cliVersion: null,
      cliError: 'Salesforce CLI (sf) was not found on PATH.',
      defaultOrg: settings.defaultOrg.trim() || null,
      org: null,
      aliases: [],
      dxProject,
      projectRoot: settings.projectRoot.trim() || null,
      ...agent,
      at
    };
  }
  if (version.code !== 0) {
    const agent = await agentDoctorFields(deps, settings, false);
    return {
      cliOk: false,
      cliVersion: null,
      cliError: version.stderr.trim() || version.stdout.trim() || `sf --version failed (${version.code})`,
      defaultOrg: settings.defaultOrg.trim() || null,
      org: null,
      aliases: [],
      dxProject,
      projectRoot: settings.projectRoot.trim() || null,
      ...agent,
      at
    };
  }

  const listed = parseOrgList((await deps.execSf(['org', 'list', '--json'])).stdout);
  const alias = settings.defaultOrg.trim() || listed.find((row) => row.isDefault)?.alias || null;
  let org = null;
  let cliError: string | null = null;
  if (alias) {
    const display = await deps.execSf(['org', 'display', '--json', '--target-org', alias]);
    if (display.code === 0) {
      const resolved = parseOrgDisplay(display.stdout, alias, settings.apiVersion);
      org = resolved ? publicOrgView(resolved) : null;
    } else {
      cliError = display.stderr.trim() || display.stdout.trim() || 'sf org display failed';
    }
  }

  const agent = await agentDoctorFields(deps, settings, true);
  return {
    cliOk: true,
    cliVersion: parseCliVersion(version.stdout),
    cliError,
    defaultOrg: alias,
    org,
    aliases: listed.map((row) => ({
      alias: row.alias,
      username: row.username,
      kind: row.kind,
      isDefault: row.isDefault
    })),
    dxProject,
    projectRoot: settings.projectRoot.trim() || null,
    ...agent,
    at
  };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [
    `CLI: ${report.cliOk ? report.cliVersion ?? 'ok' : report.cliError ?? 'missing'}`,
    `DX project: ${report.dxProject ? report.projectRoot ?? 'yes' : 'not detected'}`,
    `Target org: ${report.defaultOrg ?? '(none)'}`,
    `Agent Script: compiler ${report.agentCompiler}${report.agentPluginOk ? ', sf agent ok' : ', sf agent missing'} (${report.agentBundleCount} .agent)`,
    'Publish/activate: confirmation required (headless skipped)'
  ];
  if (report.org) {
    lines.push(`  username: ${report.org.username}`);
    lines.push(`  orgId: ${report.org.orgId || '(unknown)'}`);
    lines.push(`  kind: ${report.org.kind}`);
    lines.push(`  instance: ${report.org.instanceUrl}`);
    lines.push(`  api: ${report.org.apiVersion}`);
  }
  if (report.aliases.length > 0) {
    lines.push('Aliases:');
    for (const row of report.aliases.slice(0, 20)) {
      lines.push(`  ${row.isDefault ? '*' : ' '} ${row.alias}  ${row.username}  ${row.kind}`);
    }
  }
  if (report.cliError && report.cliOk) lines.push(`Note: ${report.cliError}`);
  return `${lines.join('\n')}\n`;
}

export function doctorFailure(error: unknown): { ok: false; error: string; code: string } {
  if (error instanceof ConnectionError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    code: 'doctor_failed'
  };
}

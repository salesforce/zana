/**
 * MastracodeProvider — launching the Mastra Code TUI (`mastracode`) for CLI Agent.
 *
 * Thread already speaks Mastra Code over ACP (`mastracode --acp`). This family is
 * the interactive terminal: bare `mastracode` in a PTY. `--prompt` / a positional
 * prompt forks headless and exits, so the seed-prompt argv channel stays off.
 * CLI Agent / Team opening tasks ride stdin after the TUI is ready instead.
 * `--mode` / `--continue` / `--thinking-level` are headless-only; the TUI honors
 * `MASTRACODE_YOLO` and `MASTRACODE_MODEL_ID`. Rule 6: profile literals live
 * only here + the registration.
 */

import type { AppConfig, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type {
  RemoteCommandInput,
  RemoteCommandResult,
  ResolvedLaunch
} from '../launch-provider.js';
import { BaseLaunchProvider } from '../base-provider.js';
import type { ModelLevel } from '@zana-ai/zcc-domain/harness-adapter';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';

const MASTRACODE_EVIDENCE_VERSION = '2026.09.13';
const MASTRACODE_OPENING_PROMPT_EVIDENCE = {
  id: 'mastracode.facet.opening-prompt',
  versionRange: MASTRACODE_EVIDENCE_VERSION,
  scope: 'local' as const,
  probe: 'mastracode --help plus provider contract suite',
  observed: 'TUI ignores --prompt argv (headless fork). Interactive first task is typed stdin after ready.',
  reviewedAt: '2026-09-13'
};

const MASTRACODE_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'mastracode',
    label: 'Mastra Code',
    agentDefaultEligible: true,
    terminalEligible: false,
    defaultProfileId: 'mastracode',
    profiles: [
      { id: 'mastracode', posture: 'default' },
      { id: 'mastracode-resume', posture: 'resume' },
      { id: 'mastracode-yolo', posture: 'unrestricted' }
    ],
    capabilities: facetSupport({ 'opening-prompt': 'unsupported' }, undefined, {
      'opening-prompt': MASTRACODE_OPENING_PROMPT_EVIDENCE
    }),
    settingsContributionIds: [],
    configFiles: [{
      id: 'native-settings',
      label: 'Native settings',
      scopes: [],
      effect: 'unsupported',
      rawEdit: false,
      reason: 'Native Mastra Code config is not launcher-injected.'
    }],
    targets: {
      roles: [],
      providers: [],
      providerModelRelationship: 'provider-then-model',
      models: [],
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined },
      // CLI Agent Edits is a portable label. TUI does not honor --mode (Plan/Fast
      // live on ACP). Interactive/accept-edits map to native default. Full Access
      // is the mastracode-yolo profile (`MASTRACODE_YOLO=1`).
      executionStateMapping: {
        interactive: 'default',
        'accept-edits': 'default'
      }
    },
    initialTaskDelivery: {
      local: 'stdin-after-ready',
      remote: 'stdin-after-ready',
      readinessSignal: 'provider-ready',
      acceptanceSignal: 'delivery-attempted'
    }
  },
  executionTargetMetadata: {
    interactive: { equivalence: 'exact', scopes: ['local', 'remote'] },
    'accept-edits': { equivalence: 'exact', scopes: ['local', 'remote'] }
  },
  collision: {
    model: [{ names: ['--model', '-m'], arity: 1, acceptsAttachedValue: true }],
    execution: [
      { names: ['--mode'], arity: 1, acceptsAttachedValue: true },
      { names: ['--permission-mode'], arity: 1, acceptsAttachedValue: true }
    ],
    terminatesAtDoubleDash: true
  },
  status: { mode: 'output-activity' },
  evidence: [MASTRACODE_OPENING_PROMPT_EVIDENCE]
};

function mastracodeBinary(config: AppConfig): string {
  return config.mastracodeBinary || 'mastracode';
}

const YOLO_ENV = { MASTRACODE_YOLO: '1' } as const;

export class MastracodeProvider extends BaseLaunchProvider {
  readonly id = 'mastracode';
  readonly adapter = MASTRACODE_ADAPTER;
  readonly acceptsUnlistedModelTargets = true;

  modelContribution(targetId: string, _level?: ModelLevel) {
    return { args: ['--model', targetId] };
  }

  executionContribution(_targetId: string) {
    return {};
  }

  roleContribution(_roleId: string) {
    return {};
  }

  resolveLaunch(profile: LaunchProfileId, config: AppConfig, _autoModeActive: boolean): ResolvedLaunch {
    const command = mastracodeBinary(config);
    if (profile === 'mastracode-resume') {
      return { command, args: ['--continue'] };
    }
    if (profile === 'mastracode-yolo') {
      return { command, args: [], env: { ...YOLO_ENV } };
    }
    return { command, args: [] };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    return profile === 'mastracode-resume';
  }

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    const result = this.simpleRemoteExec(input, 'mastracode');
    const profile = input.persona?.baseProfile ?? input.profile;
    if (profile !== 'mastracode-yolo') return result;
    return { ...result, cmd: result.cmd.replace(/(^| )exec /, '$1env MASTRACODE_YOLO=1 exec ') };
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'mastracode-resume') return 'mastracode --continue';
    if (profile === 'mastracode-yolo') return 'mastracode (yolo)';
    return 'mastracode';
  }
}

/**
 * GrokProvider — launching the Grok Build TUI (`grok`) for CLI Agent.
 *
 * Thread already speaks Grok over ACP (`grok agent stdio`). This family is the
 * interactive terminal: `grok [PROMPT]`, `--continue` to resume, and
 * `--always-approve` for unrestricted. NONE of Claude's launcher-injected flags
 * apply. Rule 6: profile literals live only here + the registration.
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

const GROK_EVIDENCE_VERSION = '2026.09.09';
const GROK_OPENING_PROMPT_EVIDENCE = {
  id: 'grok.facet.opening-prompt',
  versionRange: GROK_EVIDENCE_VERSION,
  scope: 'local' as const,
  probe: 'grok --help plus provider contract suite',
  observed: 'CLI binds an opening prompt as a positional argument.',
  reviewedAt: '2026-09-09'
};

const GROK_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'grok',
    label: 'Grok Build',
    agentDefaultEligible: true,
    terminalEligible: false,
    defaultProfileId: 'grok',
    profiles: [
      { id: 'grok', posture: 'default' },
      { id: 'grok-resume', posture: 'resume' },
      { id: 'grok-yolo', posture: 'unrestricted' }
    ],
    capabilities: facetSupport({ 'opening-prompt': 'exact' }, undefined, {
      'opening-prompt': GROK_OPENING_PROMPT_EVIDENCE
    }),
    settingsContributionIds: [],
    configFiles: [{
      id: 'native-settings',
      label: 'Native settings',
      scopes: [],
      effect: 'unsupported',
      rawEdit: false,
      reason: 'Native Grok config is not launcher-injected.'
    }],
    targets: {
      roles: [],
      providers: [],
      providerModelRelationship: 'provider-then-model',
      models: [],
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined },
      // CLI Agent Edits is a portable label. Grok has no --accept-edits flag —
      // the TUI already prompts — so map interactive/accept-edits to native
      // default (empty argv). Plan and Full/autonomous stay off this map:
      // Plan is unsupported; Full Access is the grok-yolo profile.
      executionStateMapping: {
        interactive: 'default',
        'accept-edits': 'default'
      }
    },
    initialTaskDelivery: {
      local: 'spawn-arg',
      remote: 'spawn-arg',
      readinessSignal: 'process-spawned',
      acceptanceSignal: 'argv-bound'
    }
  },
  executionTargetMetadata: {
    interactive: { equivalence: 'exact', scopes: ['local', 'remote'] },
    'accept-edits': { equivalence: 'exact', scopes: ['local', 'remote'] }
  },
  collision: {
    model: [{ names: ['--model', '-m'], arity: 1, acceptsAttachedValue: true }],
    execution: [{ names: ['--always-approve'], arity: 0 }],
    terminatesAtDoubleDash: true
  },
  status: { mode: 'output-activity' },
  evidence: [GROK_OPENING_PROMPT_EVIDENCE]
};

function grokBinary(config: AppConfig): string {
  return config.grokBinary || 'grok';
}

export class GrokProvider extends BaseLaunchProvider {
  readonly id = 'grok';
  readonly adapter = GROK_ADAPTER;
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
    const command = grokBinary(config);
    if (profile === 'grok-resume') {
      return { command, args: ['--continue'] };
    }
    if (profile === 'grok-yolo') {
      return { command, args: ['--always-approve'] };
    }
    return { command, args: [] };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    return profile === 'grok-resume';
  }

  buildRemoteCommand(input: RemoteCommandInput): RemoteCommandResult {
    return this.simpleRemoteExec(input, 'grok');
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'grok-resume') return 'grok --continue';
    if (profile === 'grok-yolo') return 'grok --always-approve';
    return 'grok';
  }
}

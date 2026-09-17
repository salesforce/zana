import type { AppConfig, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import type { RemoteCommandInput, RemoteCommandResult, ResolvedLaunch } from '../launch-provider.js';
import { BaseLaunchProvider } from '../base-provider.js';
import { facetSupport, type TrustedHarnessAdapter } from '../adapter-contract.js';

const AFCODE_ADAPTER: TrustedHarnessAdapter = {
  descriptor: {
    id: 'afcode', label: 'Agentforce Code', agentDefaultEligible: true, terminalEligible: false,
    defaultProfileId: 'afcode',
    profiles: [
      { id: 'afcode', posture: 'default' },
      { id: 'afcode-resume', posture: 'resume' },
      { id: 'afcode-yolo', posture: 'unrestricted' }
    ],
    capabilities: facetSupport({ 'opening-prompt': 'unsupported' }),
    settingsContributionIds: [], modelSelection: 'native-only',
    configFiles: [{ id: 'native-settings', label: 'Native afcode configuration', scopes: [], effect: 'unsupported', rawEdit: false, reason: 'Managed by afcode; ZCC does not rewrite native configuration.' }],
    targets: {
      roles: [], providers: [], models: [], providerModelRelationship: 'provider-then-model',
      modelLevelMapping: { low: undefined, medium: undefined, high: undefined, 'extra-high': undefined },
      executionStateMapping: { interactive: 'default', 'accept-edits': 'default' }
    },
    initialTaskDelivery: {
      local: 'stdin-after-ready', remote: 'unsupported',
      readinessSignal: 'provider-ready', acceptanceSignal: 'delivery-attempted'
    }
  },
  executionTargetMetadata: {
    interactive: { equivalence: 'exact', scopes: ['local'] },
    'accept-edits': { equivalence: 'exact', scopes: ['local'] }
  },
  collision: {
    model: [{ names: ['--model', '-m'], arity: 1, acceptsAttachedValue: true }],
    execution: [{ names: ['--auto-approve'], arity: 0 }],
    terminatesAtDoubleDash: true
  },
  // Claude-like TUI: OSC titles still classify via AgentStatusTracker, and
  // output-activity ignores control-only idle frames so the session can settle.
  status: { mode: 'output-activity' }, evidence: []
};

export class AfcodeProvider extends BaseLaunchProvider {
  readonly id = 'afcode';
  readonly adapter = AFCODE_ADAPTER;
  // Both native displays enable bracketed paste after startup/terminal probes.
  // The earlier banner is not readiness: input sent there can be discarded.
  readonly stdinReadyMarker = '\x1b[?2004h';

  executionContribution(_targetId: string) {
    // Both supported postures retain afcode's native tool confirmations.
    return {};
  }

  resolveLaunch(profile: LaunchProfileId, config: AppConfig, _autoModeActive: boolean, resumeSessionId?: string): ResolvedLaunch {
    const command = config.harnesses?.byId?.afcode?.binary || config.afcodeBinary || 'afcode';
    // Keep execution inside the PTY process; a detached worker outlives Stop.
    const args = ['--local'];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    else if (profile === 'afcode-resume') args.push('--resume');
    if (profile === 'afcode-yolo') args.push('--auto-approve');
    return { command, args };
  }

  baseArgsPinSession(profile: LaunchProfileId): boolean {
    return profile === 'afcode-resume';
  }

  buildRemoteCommand(_input: RemoteCommandInput): RemoteCommandResult {
    throw new Error('afcode CLI Agents currently support local projects only.');
  }

  title(profile: LaunchProfileId): string {
    if (profile === 'afcode-resume') return 'afcode --local --resume';
    if (profile === 'afcode-yolo') return 'afcode --local --auto-approve';
    return 'afcode --local';
  }
}

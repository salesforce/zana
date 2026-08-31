import type {
  PendingInteraction,
  PendingInteractionApprovalDecision,
  PendingInteractionApprovalSubject,
  PendingInteractionCommandAction,
  PendingInteractionGrantablePermissionProfile,
  PendingInteractionGrantedPermissionProfile,
  PendingInteractionMacOsPermissions,
  PendingInteractionRequestedPermissionProfile,
  PendingInteractionResolution
} from '@zana-ai/zcc-domain/thread-runtime';
import { isApprovalPendingInteractionPayload } from '@zana-ai/zcc-domain/thread-runtime';

type PendingInteractionPermissionSummaryProfile =
  | PendingInteractionGrantablePermissionProfile
  | PendingInteractionRequestedPermissionProfile;

function summarizeRequestedMacOsPermissions(
  permissions: PendingInteractionMacOsPermissions | null
): string[] {
  if (permissions === null) return [];
  const summaries: string[] = [];
  if (permissions.accessibility) summaries.push('macOS accessibility');
  if (permissions.launchServices) summaries.push('macOS launch services');
  if (permissions.calendar) summaries.push('macOS calendar');
  if (permissions.reminders) summaries.push('macOS reminders');
  if (permissions.preferences !== 'none') {
    summaries.push(`macOS preferences (${permissions.preferences.replace('_', ' ')})`);
  }
  if (permissions.contacts !== 'none') {
    summaries.push(`macOS contacts (${permissions.contacts.replace('_', ' ')})`);
  }
  if (permissions.automations === 'all') {
    summaries.push('macOS automation (all apps)');
  } else if (permissions.automations !== 'none' && permissions.automations.bundleIds.length > 0) {
    summaries.push(
      permissions.automations.bundleIds.length === 1
        ? 'macOS automation (1 app)'
        : `macOS automation (${permissions.automations.bundleIds.length} apps)`
    );
  }
  return summaries;
}

export function summarizePendingInteractionRequestedPermissions(
  permissions: PendingInteractionPermissionSummaryProfile
): string[] {
  const summaries: string[] = [];
  if (permissions.network?.enabled === true) summaries.push('Network access');
  if (permissions.fileSystem) {
    if (permissions.fileSystem.read.length > 0) {
      summaries.push(
        permissions.fileSystem.read.length === 1
          ? 'Read 1 path'
          : `Read ${permissions.fileSystem.read.length} paths`
      );
    }
    if (permissions.fileSystem.write.length > 0) {
      summaries.push(
        permissions.fileSystem.write.length === 1
          ? 'Write 1 path'
          : `Write ${permissions.fileSystem.write.length} paths`
      );
    }
  }
  return [
    ...summaries,
    ...summarizeRequestedMacOsPermissions('macos' in permissions ? permissions.macos : null)
  ];
}

export type PendingInteractionDetail = {
  kind: 'text' | 'code';
  label: string;
  value: string;
};

function normalizeComparable(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function permissionDetail(
  label: string,
  permissions: PendingInteractionGrantablePermissionProfile | null
): PendingInteractionDetail | null {
  if (permissions === null) return null;
  const summaries = summarizePendingInteractionRequestedPermissions(permissions);
  return summaries.length > 0 ? { kind: 'text', label, value: summaries.join(', ') } : null;
}

function summarizeCommandActions(
  actions: PendingInteractionCommandAction[],
  command: string
): PendingInteractionDetail[] {
  const commandKey = normalizeComparable(command);
  const details: PendingInteractionDetail[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'read':
        details.push({ kind: 'text', label: 'Action', value: `Read ${action.path}` });
        break;
      case 'listFiles':
        details.push({
          kind: 'text',
          label: 'Action',
          value: action.path ? `List files in ${action.path}` : 'List files'
        });
        break;
      case 'search':
        details.push({
          kind: 'text',
          label: 'Action',
          value: action.query
            ? `Search for ${action.query}${action.path ? ` in ${action.path}` : ''}`
            : action.path
              ? `Search in ${action.path}`
              : 'Search files'
        });
        break;
      default:
        if (normalizeComparable(action.command) === commandKey) break;
        details.push({ kind: 'code', label: 'Action', value: action.command });
    }
  }
  return details;
}

export function pendingInteractionSubjectDetails(interaction: PendingInteraction): PendingInteractionDetail[] {
  if (interaction.payload.kind === 'plugin') return [];
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return interaction.payload.questions.map((question) => ({
      kind: 'text',
      label: 'Question',
      value: question.prompt
    }));
  }
  switch (interaction.payload.subject.kind) {
    case 'command': {
      const sessionGrant = permissionDetail('Session grant', interaction.payload.subject.sessionGrant);
      return [
        { kind: 'code', label: 'Command', value: interaction.payload.subject.command },
        ...(interaction.payload.subject.cwd
          ? [{ kind: 'text' as const, label: 'Cwd', value: interaction.payload.subject.cwd }]
          : []),
        ...summarizeCommandActions(interaction.payload.subject.actions, interaction.payload.subject.command),
        ...(sessionGrant ? [sessionGrant] : [])
      ];
    }
    case 'file_change': {
      const sessionGrant = permissionDetail('Session grant', interaction.payload.subject.sessionGrant);
      return [
        { kind: 'text', label: 'Item', value: interaction.payload.subject.itemId },
        ...(interaction.payload.subject.writeScope
          ? [{ kind: 'text' as const, label: 'Write root', value: interaction.payload.subject.writeScope }]
          : []),
        ...(sessionGrant ? [sessionGrant] : [])
      ];
    }
    case 'permission_grant': {
      const permissions = summarizePendingInteractionRequestedPermissions(
        interaction.payload.subject.permissions
      );
      return [
        ...(interaction.payload.subject.toolName
          ? [{ kind: 'text' as const, label: 'Tool', value: interaction.payload.subject.toolName }]
          : []),
        ...permissions.map((permission) => ({ kind: 'text' as const, label: 'Permission', value: permission }))
      ];
    }
    case 'plan':
      return interaction.payload.subject.planFilePath
        ? [{ kind: 'text', label: 'Plan file', value: interaction.payload.subject.planFilePath }]
        : [];
    default:
      return [];
  }
}

export function formatPendingInteractionSubjectDetailLines(interaction: PendingInteraction): string[] {
  if (interaction.payload.kind !== 'plugin' && !isApprovalPendingInteractionPayload(interaction.payload)) {
    return interaction.payload.questions.map((question) => question.prompt);
  }
  return pendingInteractionSubjectDetails(interaction).map((detail) => `${detail.label}: ${detail.value}`);
}

export function shouldShowPendingInteractionReason(
  reason: string | null | undefined,
  details: readonly PendingInteractionDetail[]
): boolean {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return false;
  const reasonKey = normalizeComparable(trimmed);
  return !details.some((detail) => normalizeComparable(detail.value) === reasonKey);
}

function toGrantedPermissions(
  permissions: PendingInteractionPermissionSummaryProfile
): PendingInteractionGrantedPermissionProfile {
  return {
    network: permissions.network?.enabled === true ? { enabled: true } : null,
    fileSystem: permissions.fileSystem
      ? { read: permissions.fileSystem.read, write: permissions.fileSystem.write }
      : null
  };
}

export function buildPendingInteractionApprovalResolution(
  interaction: PendingInteraction,
  decision: PendingInteractionApprovalDecision
): PendingInteractionResolution {
  if (decision === 'deny') return { decision };
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return { decision, grantedPermissions: null };
  }
  if (interaction.payload.subject.kind === 'permission_grant') {
    return {
      decision,
      grantedPermissions: toGrantedPermissions(interaction.payload.subject.permissions)
    };
  }
  if (decision !== 'allow_for_session') {
    return { decision, grantedPermissions: null };
  }
  if (interaction.payload.subject.kind === 'command' || interaction.payload.subject.kind === 'file_change') {
    return { decision, grantedPermissions: interaction.payload.subject.sessionGrant };
  }
  return { decision, grantedPermissions: null };
}

export function approvalDecisionLabel(
  decision: PendingInteractionApprovalDecision,
  subjectKind?: PendingInteractionApprovalSubject['kind']
): string {
  if (subjectKind === 'plan') {
    return decision === 'deny' ? 'Keep planning' : 'Approve plan';
  }
  switch (decision) {
    case 'allow_once':
      return 'Allow once';
    case 'allow_for_session':
      return 'Allow for session';
    case 'deny':
      return 'Deny';
  }
}

export function approvalDecisionTone(
  decision: PendingInteractionApprovalDecision
): 'primary' | 'secondary' | 'ghost' {
  switch (decision) {
    case 'allow_once':
      return 'primary';
    case 'allow_for_session':
      return 'secondary';
    case 'deny':
      return 'ghost';
  }
}

export function initialApprovalDecisionIndex(
  decisions: readonly PendingInteractionApprovalDecision[]
): number {
  const once = decisions.indexOf('allow_once');
  return once >= 0 ? once : 0;
}

export function approvalDecisionIndexForKey(
  key: string,
  current: number,
  count: number
): number | undefined {
  if (count < 1) return undefined;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

export function approvalDecisionTabIndex(index: number, activeIndex: number): 0 | -1 {
  return index === activeIndex ? 0 : -1;
}

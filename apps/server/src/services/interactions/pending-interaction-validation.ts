import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isPluginPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
  type ApprovalPendingInteractionPayload,
  type ApprovalPendingInteractionResolution,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type PendingInteractionGrantedPermissionProfile,
  type PendingInteractionResolution,
  type UserQuestionPendingInteractionPayload
} from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';

type GrantedPendingInteractionResolution = Extract<
  ApprovalPendingInteractionResolution,
  { decision: 'allow_once' | 'allow_for_session' }
>;
type ApprovalPendingInteraction = PendingInteraction & {
  payload: ApprovalPendingInteractionPayload;
};
type UserQuestionPendingInteraction = PendingInteraction & {
  payload: UserQuestionPendingInteractionPayload;
};

function isApprovalPendingInteraction(
  interaction: PendingInteraction
): interaction is ApprovalPendingInteraction {
  return isApprovalPendingInteractionPayload(interaction.payload);
}

function isUserQuestionPendingInteraction(
  interaction: PendingInteraction
): interaction is UserQuestionPendingInteraction {
  return isUserQuestionPendingInteractionPayload(interaction.payload);
}

function stringSetEquals(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  return [...leftSet].every((value) => rightSet.has(value));
}

function permissionProfileEquals(
  left: PendingInteractionGrantedPermissionProfile,
  right: PendingInteractionGrantedPermissionProfile
): boolean {
  if (left.network?.enabled !== right.network?.enabled) return false;
  if (left.fileSystem === null || right.fileSystem === null) {
    return left.fileSystem === right.fileSystem;
  }
  return (
    stringSetEquals(left.fileSystem.read, right.fileSystem.read)
    && stringSetEquals(left.fileSystem.write, right.fileSystem.write)
  );
}

function grantedResolutionEquals(
  left: GrantedPendingInteractionResolution,
  right: GrantedPendingInteractionResolution
): boolean {
  if (left.grantedPermissions === null || right.grantedPermissions === null) {
    return left.grantedPermissions === right.grantedPermissions;
  }
  return permissionProfileEquals(left.grantedPermissions, right.grantedPermissions);
}

function hasNonWhitespaceText(value: string): boolean {
  return value.trim().length > 0;
}

export function pendingInteractionResolutionEquals(
  left: PendingInteraction['resolution'],
  right: PendingInteraction['resolution']
): boolean {
  if (left === null || right === null) return left === right;
  if (isPluginPendingInteractionResolution(left) || isPluginPendingInteractionResolution(right)) {
    return isPluginPendingInteractionResolution(left) && isPluginPendingInteractionResolution(right);
  }
  if (
    isUserQuestionPendingInteractionResolution(left)
    || isUserQuestionPendingInteractionResolution(right)
  ) {
    if (
      !isUserQuestionPendingInteractionResolution(left)
      || !isUserQuestionPendingInteractionResolution(right)
    ) {
      return false;
    }
    const leftKeys = Object.keys(left.answers);
    const rightKeys = Object.keys(right.answers);
    if (!stringSetEquals(leftKeys, rightKeys)) return false;
    return leftKeys.every((questionId) => {
      const leftAnswer = left.answers[questionId];
      const rightAnswer = right.answers[questionId];
      return (
        leftAnswer !== undefined
        && rightAnswer !== undefined
        && stringSetEquals(leftAnswer.selected, rightAnswer.selected)
        && leftAnswer.freeText === rightAnswer.freeText
      );
    });
  }
  if (
    !isApprovalPendingInteractionResolution(left)
    || !isApprovalPendingInteractionResolution(right)
  ) {
    return false;
  }
  switch (left.decision) {
    case 'deny':
      return right.decision === 'deny';
    case 'allow_once':
      return right.decision === 'allow_once' && grantedResolutionEquals(left, right);
    case 'allow_for_session':
      return right.decision === 'allow_for_session' && grantedResolutionEquals(left, right);
  }
}

function validateAvailableDecision(
  interaction: ApprovalPendingInteraction,
  decision: PendingInteractionApprovalDecision
): void {
  if (interaction.payload.availableDecisions.includes(decision)) return;
  throw new ThreadCreateError(
    400,
    'invalid_request',
    `Approval decision '${decision}' is not available for interaction ${interaction.id}`
  );
}

function getRequestedPermissions(
  interaction: ApprovalPendingInteraction,
  decision: PendingInteractionApprovalDecision
): PendingInteractionGrantedPermissionProfile | null {
  if (interaction.payload.subject.kind === 'permission_grant') {
    return interaction.payload.subject.permissions;
  }
  if (decision !== 'allow_for_session') return null;
  if (interaction.payload.subject.kind === 'command' || interaction.payload.subject.kind === 'file_change') {
    return interaction.payload.subject.sessionGrant;
  }
  return null;
}

function validateGrantedPermissions(
  interaction: ApprovalPendingInteraction,
  decision: PendingInteractionApprovalDecision,
  permissions: PendingInteractionGrantedPermissionProfile
): void {
  const requestedPermissions = getRequestedPermissions(interaction, decision);
  if (requestedPermissions === null) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Granted permissions are not expected for this approval'
    );
  }
  if (!permissionProfileEquals(permissions, requestedPermissions)) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Granted permissions must match the requested permission profile'
    );
  }
}

function validateCommandOrFileChangeSessionGrant(
  interaction: ApprovalPendingInteraction,
  permissions: PendingInteractionGrantedPermissionProfile
): void {
  if (interaction.payload.subject.kind !== 'command' && interaction.payload.subject.kind !== 'file_change') {
    return;
  }
  if (interaction.payload.subject.sessionGrant === null) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Command and file-change session approvals must grant the requested session permissions exactly'
    );
  }
  if (!permissionProfileEquals(permissions, interaction.payload.subject.sessionGrant)) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Command and file-change session approvals must grant the requested session permissions exactly'
    );
  }
}

export function validatePendingInteractionResolution(
  interaction: PendingInteraction,
  resolution: PendingInteractionResolution
): void {
  if (interaction.payload.kind === 'plugin') {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Plugin interactions must be submitted through the respond endpoint'
    );
  }
  if (isUserQuestionPendingInteraction(interaction)) {
    validateUserQuestionResolution(interaction, resolution);
    return;
  }
  if (!isApprovalPendingInteraction(interaction)) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      `Unsupported pending interaction payload for interaction ${interaction.id}`
    );
  }
  if (!isApprovalPendingInteractionResolution(resolution)) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'User-answer resolutions can only resolve user-question interactions'
    );
  }
  validateAvailableDecision(interaction, resolution.decision);
  if (resolution.decision === 'deny') return;
  if (resolution.grantedPermissions !== null) {
    validateGrantedPermissions(interaction, resolution.decision, resolution.grantedPermissions);
    if (resolution.decision === 'allow_for_session') {
      validateCommandOrFileChangeSessionGrant(interaction, resolution.grantedPermissions);
    }
    return;
  }
  if (interaction.payload.subject.kind === 'permission_grant') {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Allowed permission-grant resolutions must include granted permissions'
    );
  }
  if (
    resolution.decision === 'allow_for_session'
    && (interaction.payload.subject.kind === 'command' || interaction.payload.subject.kind === 'file_change')
    && interaction.payload.subject.sessionGrant !== null
  ) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Session approval resolutions must include granted permissions'
    );
  }
}

function validateUserQuestionResolution(
  interaction: UserQuestionPendingInteraction,
  resolution: PendingInteractionResolution
): void {
  if (!isUserQuestionPendingInteractionResolution(resolution)) {
    throw new ThreadCreateError(
      400,
      'invalid_request',
      'Approval resolutions can only resolve approval interactions'
    );
  }
  const questionById = new Map(interaction.payload.questions.map((question) => [question.id, question]));
  for (const answerQuestionId of Object.keys(resolution.answers)) {
    if (!questionById.has(answerQuestionId)) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Answer references unknown question '${answerQuestionId}'`
      );
    }
  }
  for (const question of interaction.payload.questions) {
    const answer = resolution.answers[question.id];
    if (!answer) {
      throw new ThreadCreateError(400, 'invalid_request', `Missing answer for question '${question.id}'`);
    }
    const selectedValues = new Set(answer.selected);
    if (selectedValues.size !== answer.selected.length) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Answer for question '${question.id}' contains duplicate selections`
      );
    }
    const optionCount = question.options?.length ?? 0;
    if (answer.selected.length > optionCount) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Answer for question '${question.id}' selects more options than are available`
      );
    }
    if (!question.multiSelect && answer.selected.length > 1) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Question '${question.id}' accepts only one selected option`
      );
    }
    const optionValues = new Set((question.options ?? []).map((option) => option.value));
    for (const selectedValue of answer.selected) {
      if (!optionValues.has(selectedValue)) {
        throw new ThreadCreateError(
          400,
          'invalid_request',
          `Answer for question '${question.id}' selected an unavailable option`
        );
      }
    }
    if (!question.allowFreeText && answer.freeText !== undefined) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Question '${question.id}' does not accept free-text answers`
      );
    }
    if (question.allowFreeText && answer.freeText !== undefined && !hasNonWhitespaceText(answer.freeText)) {
      throw new ThreadCreateError(400, 'invalid_request', 'User question free text cannot be blank');
    }
    if (answer.selected.length === 0 && answer.freeText === undefined) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        `Question '${question.id}' must include a selected option or free-text answer`
      );
    }
  }
}

/** Slice of product.ts — persona / team / squad vocabulary. */

export type {
  PersonaSource,
  PersonaHarnessIntentV1,
  PersonaHarnessRoutingV1,
  HarnessModelRoutingV1,
  Persona,
  PersonaInput,
  PersonaSummary,
  TeamSlot,
  TeamLaunchTaskSlot,
  TeamLaunchAuthorizationInputSlot,
  TeamLaunchAuthorizationResult,
  TeamLaunchRequestInput,
  TeamLaunchedWorker,
  TeamFailedWorkerSlot,
  LaunchTeamResult,
  CancelTeamLaunchResult,
  Team,
  TeamInput,
  SquadBundle,
  TeamSummary,
  SquadSummary,
  AutonomousRunState,
  AutonomousRunStopReason,
  AutonomousRunLimits,
  AutonomousRun,
  SubagentChild,
  SquadFlowNode,
  SquadFlowEdge,
  SquadFlowGraph
} from './product.js';

export {
  toPersonaSummary,
  toTeamSummary
} from './product.js';

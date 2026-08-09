/**
 * Public surface of @zcc/streamdeck. Exposes the app factory and the reusable
 * primitives (deck framework, control-plane source, action queue) for
 * programmatic use and testing.
 */

export { createDeckApp, type DeckApp, type DeckAppOpts } from './app.js';

export { DeckController, COLS, ROWS, XL, coordToIndex, indexToCoord } from './deck/device.js';
export type { DeckDevice, Geometry } from './deck/device.js';
export { buildGrid, buildOverlay, bodyCapacity } from './deck/layout.js';
export type { GridSpec, OverlaySpec, TileSpec } from './deck/layout.js';
export { Page, Navigator, coordKey } from './deck/page.js';
export type { Key, KeyImage, Coord } from './deck/page.js';
export { statusTile, labelTile, STATUS_RGB, TILE } from './deck/renderer.js';
export { openDeck } from './deck/elgato-device.js';

export { ZccSource, type ZccSourceOpts } from './lib/zcc-source.js';
export { ActionQueue, type Intent, type DispatchResult } from './lib/actions.js';
export { AgentPoller, type PollerOpts } from './lib/poller.js';
export {
  callControlPlane,
  isAppRunning,
  readControlToken,
  resolveDataDir,
  type ControlClientResult,
  type ControlCallOpts
} from './lib/control-client.js';
export {
  type AgentListItem,
  type AgentState,
  type DeckStatus,
  type ProjectItem,
  type ScheduleItem,
  type StatusSummary,
  type SpawnProfile,
  agentLabel,
  projectLabel,
  scheduleLabel,
  stateToDeckStatus
} from './lib/types.js';

export { buildMainPage, type MainPageDeps } from './pages/main-page.js';
export { buildZccMenuPage, type ZccMenuDeps } from './pages/zcc-menu-page.js';
export { buildAgentsPage, AGENT_SLOTS, type AgentsPageDeps } from './pages/agents-page.js';
export { buildAgentActionsPage, type AgentActionsDeps } from './pages/agent-actions-page.js';
export { buildProjectsPage, PROJECT_SLOTS, type ProjectsPageDeps } from './pages/projects-page.js';
export { buildProjectActionsPage, type ProjectActionsDeps } from './pages/project-actions-page.js';
export { buildSchedulesPage, SCHEDULE_SLOTS, type SchedulesPageDeps } from './pages/schedules-page.js';
export { buildScheduleActionsPage, type ScheduleActionsDeps } from './pages/schedule-actions-page.js';
export { buildStatusPage, type StatusPageDeps } from './pages/status-page.js';

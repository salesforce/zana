/**
 * Squad Flow projection — the pure core behind the Agents board's "Flow" view.
 *
 * A "squad" has no runtime template→session binding (squad templates in
 * `~/.zana/teams` carry no live member identity), so we project the *live agent
 * mesh* of one project into a graph: nodes = registered/live agents, node state
 * = the live status slice, edges = the agent→agent message log aggregated into
 * directed handoffs. NEVER persisted — `buildSquadFlow` is a pure function of
 * its inputs, rebuilt on every read (and memoized by the caller).
 *
 * Rule 6: nothing here branches on the literal `'zana'`. The squad descriptor,
 * when present, is supplied by the caller from the generic `squads.list` IPC.
 */
import type {
  AgentMessage,
  AgentRecord,
  AgentState,
  ExecutionBoardProjection,
  SquadFlowEdge,
  SquadFlowGraph,
  SquadFlowNode,
  SquadSummary,
  SubagentChild,
  TerminalSession
} from '@zana-ai/zcc-domain/product';

/** Newest-N messages folded into the edge set (Rule 5: bound an unbounded read). */
export const SQUAD_FLOW_EDGE_MESSAGE_CAP = 200;

/**
 * Bucket id for agents (and unregistered sessions) that carry no
 * {@link AgentRecord.teamLaunchId} — i.e. solo / non-team agents. Used as the
 * synthetic launch key so the solo bucket can be selected like any squad.
 */
export const SOLO_LAUNCH_ID = '__solo__';

/**
 * A squad is QUIESCENT when it has members and EVERY one has exited — the whole
 * team is done. The Flow view uses this to render a finished squad as a static,
 * muted graph: the `hot` (gold, most-recent-handoff) edge highlight and the
 * flowing chevron animation are frozen so a done job doesn't keep animating a
 * "working" flow after every node exited. Strictly all-exited (not "no work
 * right now") so a still-live idle/working/blocked member keeps the graph alive.
 */
export function isQuiescentSquad(summary: { total: number; exited: number }): boolean {
  return summary.total > 0 && summary.exited === summary.total;
}

/** Raw, already-project-scoped slice data the projection folds into a graph. */
export interface SquadFlowInputs {
  projectId: string;
  /** Live terminal sessions for the project (drives liveness + unregistered agents). */
  sessions: TerminalSession[];
  /** Registry agents for the project (authoritative identity). */
  agents: AgentRecord[];
  /** Agent→agent messages for the project (edge source). */
  messages: AgentMessage[];
  /** Live state per sessionId (from the status slice). */
  statusById: Record<string, AgentState>;
  /** Renderer-clock ms each session entered its current state. */
  sinceById: Record<string, number>;
  /** Live Task-tool sub-agent count per sessionId. */
  subagentsById: Record<string, number>;
  /** Per-parent-session sub-agent child records (name/type + running/done).
   *  Optional per node; when absent the view falls back to the count badge. */
  subagentChildrenById: Record<string, SubagentChild[]>;
  /** Durable Job projections, used only to surface an actionable Job blocker. */
  executions?: readonly ExecutionBoardProjection[];
  /** Optional squad-template descriptor for the header. */
  squad?: SquadSummary;
  /**
   * Restrict the graph to ONE squad within the project (the second picker).
   * A squad is one team launch — agents sharing a {@link AgentRecord.teamLaunchId}
   * (see types.ts: "agents within the same launch form an isolated squad"). Pass
   * {@link SOLO_LAUNCH_ID} to select only solo / non-team agents (no launch id);
   * unregistered live sessions also fall in that bucket since they carry no
   * launch id. Omitted ⇒ the merged "All squads" graph (every agent in the
   * project), preserving the original single-graph behavior.
   */
  launchFilter?: string;
  /** One consistent "now" (epoch ms) stamped onto the graph. */
  builtAt: number;
}

/** Label fallback chain, mirroring `agentLabel()` / the mesh's `prettyHandle()`. */
function labelFor(handle: string | undefined, displayName: string | undefined, sessionId: string): string {
  return handle ?? displayName ?? sessionId;
}

/**
 * Bounded claim payload for a CLAIMED assignment — only the liveness timestamps
 * the Flow view reads, each omitted when absent. Returns `undefined` when the
 * assignment carries no claim anchor at all (no `claimedAt` and no
 * `leaseExpiresAt`), so a node with no live claim signal gets no `claim` field.
 * Shared by the live-node ({@link buildSquadFlow}'s makeNode) and the
 * detached-node synthesis so the projection is byte-identical at both sites.
 */
function pickClaim(assignment: {
  claimedAt?: number;
  heartbeatAt?: number;
  progressAt?: number;
  leaseExpiresAt?: number;
}): SquadFlowNode['claim'] | undefined {
  if (assignment.claimedAt === undefined && assignment.leaseExpiresAt === undefined) return undefined;
  return {
    ...(assignment.claimedAt !== undefined ? { claimedAt: assignment.claimedAt } : {}),
    ...(assignment.heartbeatAt !== undefined ? { heartbeatAt: assignment.heartbeatAt } : {}),
    ...(assignment.progressAt !== undefined ? { progressAt: assignment.progressAt } : {}),
    ...(assignment.leaseExpiresAt !== undefined ? { leaseExpiresAt: assignment.leaseExpiresAt } : {})
  };
}

/**
 * Synthesize a worker node straight from the durable board for any CLAIMED slot
 * that NO live renderer session covers (CLI/headless resume, app restart mid-run,
 * remote spawn, or a crashed local PTY wrapper whose terminal has since exited).
 * The durable board is the liveness source of truth, but a live renderer session
 * is what normally builds a worker node — without this a stranded claim would
 * show as "no workers working" despite a live claim. Gated to executions already
 * represented by an in-scope node so a launch filter never re-admits another
 * squad's workers. Mutates `bySession` in place.
 */
function synthesizeDetachedClaimedNodes(
  executions: readonly ExecutionBoardProjection[],
  ctx: {
    inScopeExecutionIds: ReadonlySet<string>;
    sessionByExecutionSlot: ReadonlyMap<string, string>;
    bySession: Map<string, SquadFlowNode>;
  }
): void {
  const { inScopeExecutionIds, sessionByExecutionSlot, bySession } = ctx;
  for (const execution of executions) {
    if (!inScopeExecutionIds.has(execution.executionId)) continue;
    for (const assignment of execution.work?.assignments ?? []) {
      if (assignment.state !== 'CLAIMED' || !assignment.slotId) continue;
      if (sessionByExecutionSlot.has(`${execution.executionId}\0${assignment.slotId}`)) continue; // a live session already covers this slot
      const syntheticId = `detached:${execution.executionId}:${assignment.slotId}`;
      if (bySession.has(syntheticId)) continue;
      const claim = pickClaim(assignment);
      bySession.set(syntheticId, {
        sessionId: syntheticId,
        // The slot id is the only identity a detached node has, so surface it directly.
        label: assignment.slotId,
        role: 'worker',
        // A synthesized detached node has NO live signal of its own — its only
        // liveness is the durable claim. Leave it 'unknown' so nodeActivity()
        // shows motion (self-arc + streaming) ONLY when the claim carries a fresh
        // progressAt; a stranded claim renders as a static "claimed" chip, never
        // fabricated "working" activity.
        state: 'unknown',
        liveSubagents: 0,
        exited: false,
        isOrchestrator: false,
        detached: true,
        job: { executionId: execution.executionId, needsAttention: false },
        ...(claim ? { claim } : {})
      });
    }
  }
}

/**
 * Fold Job Team durable work dependencies into worker→worker edges. Job dispatch
 * bypasses the agent message log, so a durable DAG would otherwise show no
 * handoffs. Mutates `edgeByKey`/`outDegree` in place; out-degree counts each
 * UNIQUE worker pair once (multiple unit dependencies between the same pair
 * collapse to one edge, so counting every dependency would inflate the source
 * node's degree and skew orchestrator selection).
 */
function projectWorkDependencyEdges(
  executions: readonly ExecutionBoardProjection[],
  ctx: {
    sessionByExecutionSlot: Map<string, string>;
    isNode: (sessionId: string) => boolean;
    edgeByKey: Map<string, SquadFlowEdge>;
    outDegree: Map<string, number>;
  }
): void {
  const { sessionByExecutionSlot, isNode, edgeByKey, outDegree } = ctx;
  for (const execution of executions) {
    const assignments = execution.work?.assignments ?? [];
    const assignmentById = new Map(assignments.map((assignment) => [assignment.workUnitId, assignment]));
    for (const assignment of assignments) {
      if (!assignment.slotId) continue;
      const toSessionId = sessionByExecutionSlot.get(`${execution.executionId}\0${assignment.slotId}`);
      if (!toSessionId || !isNode(toSessionId)) continue;
      for (const dependencyId of assignment.dependencies) {
        const dependency = assignmentById.get(dependencyId);
        if (!dependency?.slotId) continue;
        const fromSessionId = sessionByExecutionSlot.get(`${execution.executionId}\0${dependency.slotId}`);
        if (!fromSessionId || fromSessionId === toSessionId || !isNode(fromSessionId)) continue;
        const key = `${fromSessionId}\0${toSessionId}`;
        if (edgeByKey.has(key)) continue;
        edgeByKey.set(key, {
          fromSessionId,
          toSessionId,
          count: 1,
          lastTs: execution.updatedAt,
          pending: false,
          kind: 'work-dependency'
        });
        outDegree.set(fromSessionId, (outDegree.get(fromSessionId) ?? 0) + 1);
      }
    }
  }
}

/**
 * Project one project's live mesh into a {@link SquadFlowGraph}, or `null` when
 * the project has no agent nodes at all (a "squad" is ≥1 live agent — a plain
 * shell does not count).
 */
export function buildSquadFlow(input: SquadFlowInputs): SquadFlowGraph | null {
  const executionByExecutionId = new Map((input.executions ?? []).map((e) => [e.executionId, e]));
  const executionByOrchestrator = new Map(
    (input.executions ?? []).flatMap((execution) => execution.orchestratorSessionId
      ? [[execution.orchestratorSessionId, execution] as const] : [])
  );
  const exitedBySession = new Map<string, boolean>();
  const cohortLabelBySession = new Map<string, string>();
  const executionIdBySession = new Map<string, string>();
  const cohortRoleBySession = new Map<string, string>();
  const cohortIdBySession = new Map<string, string>();
  const slotIdBySession = new Map<string, string>();
  const sessionByExecutionSlot = new Map<string, string>();
  for (const s of input.sessions) {
    exitedBySession.set(s.id, s.status === 'exited');
    if (s.cohort?.slotLabel) cohortLabelBySession.set(s.id, s.cohort.slotLabel);
    if (s.cohort?.executionId) executionIdBySession.set(s.id, s.cohort.executionId);
    if (s.cohort?.role) cohortRoleBySession.set(s.id, s.cohort.role);
    if (s.cohort?.cohortId) cohortIdBySession.set(s.id, s.cohort.cohortId);
    if (s.cohort?.slotId) slotIdBySession.set(s.id, s.cohort.slotId);
    // Only a LIVE session covers an execution slot. An exited terminal bound to a
    // still-CLAIMED slot must NOT suppress the detached-node synthesis below — the
    // durable claim is still live even though its renderer session died, so the
    // slot must read as uncovered and get a synthesized node that surfaces it.
    if (s.cohort?.executionId && s.cohort.slotId && s.status !== 'exited') {
      sessionByExecutionSlot.set(`${s.cohort.executionId}\0${s.cohort.slotId}`, s.id);
    }
  }

  // Node set: every registry agent, plus any live non-shell session that never
  // registered. Keyed by sessionId so a session that is BOTH never double-counts.
  const bySession = new Map<string, SquadFlowNode>();

  const makeNode = (
    sessionId: string,
    handle: string | undefined,
    displayName: string | undefined,
    role: string | undefined,
    capabilities: string[] | undefined
  ): SquadFlowNode => {
    const finalRole = cohortRoleBySession.get(sessionId) ?? role;
    const executionId = executionIdBySession.get(sessionId);
    const execution = (executionId ? executionByExecutionId.get(executionId) : undefined) ?? executionByOrchestrator.get(sessionId);
    const terminal = execution?.state === 'COMPLETED' || execution?.state === 'FAILED' || execution?.state === 'STOPPED';
    const needsAttention = !!execution?.currentBlocker && !terminal &&
      execution.currentBlocker.audience !== 'coordinator' &&
      execution.currentBlocker.delivery?.state !== 'PENDING' && execution.currentBlocker.delivery?.state !== 'LEASED';
    // Durable claim liveness: when THIS node's session is the assigned slot of a
    // CLAIMED work unit, surface the lease the host renews from PTY output. The
    // Flow view treats `leaseExpiresAt > builtAt` as "streaming / live" — grounded
    // in the backend's own liveness truth, not the sometimes-stale agent dot.
    const slotId = slotIdBySession.get(sessionId);
    const claimAssignment = slotId
      ? (execution?.work?.assignments ?? []).find((a) => a.slotId === slotId && a.state === 'CLAIMED')
      : undefined;
    const claim = claimAssignment ? pickClaim(claimAssignment) : undefined;
    return {
      sessionId,
      label: labelFor(handle, displayName, sessionId),
      handle,
      displayName,
      role: finalRole,
      capabilities,
      state: input.statusById[sessionId] ?? 'unknown',
      stateSince: input.sinceById[sessionId],
      liveSubagents: input.subagentsById[sessionId] ?? 0,
      subagentChildren: input.subagentChildrenById[sessionId],
      exited: exitedBySession.get(sessionId) ?? false,
      isOrchestrator: false,
      ...(execution ? { job: {
        executionId: execution.executionId,
        needsAttention,
        ...(execution.currentBlocker ? {
          blockerQuestion: execution.currentBlocker.question,
          blockerAudience: execution.currentBlocker.audience
        } : {})
      } } : {}),
      ...(claim ? { claim } : {})
    };
  };

  // Second-picker scope: when a launchFilter is set, keep only agents of that
  // one squad. A registry agent matches when its teamLaunchId equals the filter;
  // a solo agent (no launch id) matches only the SOLO bucket. Unregistered live
  // sessions carry no launch id, so they too belong to the SOLO bucket.
  const launchOf = (teamLaunchId: string | undefined): string => teamLaunchId ?? SOLO_LAUNCH_ID;
  const inScope = (teamLaunchId: string | undefined): boolean =>
    input.launchFilter === undefined || launchOf(teamLaunchId) === input.launchFilter;

  // Every session that IS a registry agent, regardless of launch scope. A
  // session is only "unregistered" (solo-bucket material) when it has no
  // registry agent at all — NOT merely when its agent was filtered out of the
  // current scope. Without this, a SOLO filter would re-admit every other
  // squad's agents through the session loop as phantom unregistered nodes.
  const agentSessionIds = new Set(input.agents.map((a) => a.sessionId));

  for (const a of input.agents) {
    if (!inScope(cohortIdBySession.get(a.sessionId) ?? a.teamLaunchId)) continue;
    // Cohort labels are main-owned, harness-neutral launch identity. Prefer them
    // over mesh handles so an OpenCode/Codex/Pi worker never renders as a generic
    // provider name merely because it skipped register_agent.
    const cohortLabel = cohortLabelBySession.get(a.sessionId);
    bySession.set(a.sessionId, makeNode(a.sessionId, cohortLabel ?? a.handle, cohortLabel ?? a.displayName, a.role, a.capabilities));
  }
  for (const s of input.sessions) {
    if (s.profile === 'shell') continue; // plain shells aren't agents
    if (agentSessionIds.has(s.id)) continue; // a registry agent — handled (or scoped out) above
    if (!inScope(s.cohort?.cohortId)) continue;
    bySession.set(s.id, makeNode(s.id, s.cohort?.slotLabel, s.cohort?.slotLabel ?? s.title, undefined, undefined));
  }

  // Detached CLAIMED workers: synthesize a node straight from the durable board
  // for any CLAIMED slot no live session covers (see synthesizeDetachedClaimedNodes).
  // In-scope = every execution already represented by a live node here.
  const inScopeExecutionIds = new Set<string>();
  for (const sessionId of bySession.keys()) {
    const execId = executionIdBySession.get(sessionId) ?? executionByOrchestrator.get(sessionId)?.executionId;
    if (execId) inScopeExecutionIds.add(execId);
  }
  synthesizeDetachedClaimedNodes(input.executions ?? [], {
    inScopeExecutionIds,
    sessionByExecutionSlot,
    bySession
  });

  if (bySession.size === 0) return null;

  // Edges: aggregate the newest-N agent→agent messages into directed buckets,
  // keeping only those whose BOTH endpoints are squad members.
  const recent =
    input.messages.length > SQUAD_FLOW_EDGE_MESSAGE_CAP
      ? [...input.messages].sort((m, n) => n.ts - m.ts).slice(0, SQUAD_FLOW_EDGE_MESSAGE_CAP)
      : input.messages;

  const edgeByKey = new Map<string, SquadFlowEdge>();
  const latestMsgByKey = new Map<string, AgentMessage>();
  const outDegree = new Map<string, number>();

  for (const m of recent) {
    if (!bySession.has(m.fromSessionId) || !bySession.has(m.toSessionId)) continue;
    const key = `${m.fromSessionId} ${m.toSessionId}`;
    const existing = edgeByKey.get(key);
    if (!existing) {
      edgeByKey.set(key, {
        fromSessionId: m.fromSessionId,
        toSessionId: m.toSessionId,
        count: 1,
        lastTs: m.ts,
        pending: m.deliveredAt === undefined
      });
      latestMsgByKey.set(key, m);
    } else {
      existing.count += 1;
      if (m.ts >= existing.lastTs) {
        existing.lastTs = m.ts;
        latestMsgByKey.set(key, m);
      }
    }
    outDegree.set(m.fromSessionId, (outDegree.get(m.fromSessionId) ?? 0) + 1);
  }

  // Recompute `pending` from whichever message is actually the latest on each edge.
  for (const [key, edge] of edgeByKey) {
    const latest = latestMsgByKey.get(key)!;
    edge.pending = latest.deliveredAt === undefined;
  }

  // Job Team dispatch bypasses agent messages. Project durable work dependencies
  // onto their assigned worker sessions so the Flow still shows actual handoffs.
  projectWorkDependencyEdges(input.executions ?? [], {
    sessionByExecutionSlot,
    isNode: (sessionId) => bySession.has(sessionId),
    edgeByKey,
    outDegree
  });

  const edges = [...edgeByKey.values()];

  // Orchestrator: highest out-degree, tie-broken by earliest registeredAt (then
  // sessionId for total determinism). registeredAt for unregistered sessions is
  // unknown → treat as +∞ so a real registry agent always wins a tie.
  const registeredAt = new Map<string, number>();
  for (const a of input.agents) registeredAt.set(a.sessionId, a.registeredAt);

  // If there's an explicit orchestrator role, pin that!
  let hasExplicitOrch = false;
  for (const node of bySession.values()) {
    if (node.role === 'orchestrator') {
      node.isOrchestrator = true;
      hasExplicitOrch = true;
      if (node.job?.needsAttention) {
        node.state = 'blocked';
      }
    }
  }

  if (!hasExplicitOrch) {
    let orchestrator: string | undefined;
    let best = { out: -1, reg: Number.POSITIVE_INFINITY, sid: '' };
    for (const node of bySession.values()) {
      const out = outDegree.get(node.sessionId) ?? 0;
      const reg = registeredAt.get(node.sessionId) ?? Number.POSITIVE_INFINITY;
      const better =
        out > best.out ||
        (out === best.out && reg < best.reg) ||
        (out === best.out && reg === best.reg && node.sessionId < best.sid);
      if (better) {
        best = { out, reg, sid: node.sessionId };
        orchestrator = node.sessionId;
      }
    }
    if (orchestrator) {
      const node = bySession.get(orchestrator)!;
      node.isOrchestrator = true;
      if (node.job?.needsAttention) {
        node.state = 'blocked';
      }
    }
  }

  const nodes = [...bySession.values()];

  const summary = { total: nodes.length, working: 0, blocked: 0, idle: 0, exited: 0 };
  for (const n of nodes) {
    if (n.exited) summary.exited += 1;
    else if (n.state === 'working') summary.working += 1;
    else if (n.state === 'blocked') summary.blocked += 1;
    else if (n.state === 'idle') summary.idle += 1;
  }

  const scopedCohorts = input.launchFilter === undefined || input.launchFilter === SOLO_LAUNCH_ID
    ? []
    : input.sessions.map((session) => session.cohort).filter((cohort) => cohort?.cohortId === input.launchFilter);
  const teamName = scopedCohorts.find((cohort) => cohort?.teamName)?.teamName;
  const executionId = scopedCohorts.find((cohort) => cohort?.executionId)?.executionId;
  const executionJobTitle = scopedCohorts.find((cohort) => cohort?.executionJobTitle)?.executionJobTitle;
  return {
    projectId: input.projectId,
    squad: input.squad,
    ...(teamName ? { teamName } : {}),
    ...(executionId ? { executionId } : {}),
    ...(executionJobTitle ? { executionJobTitle } : {}),
    nodes,
    edges,
    summary,
    builtAt: input.builtAt
  };
}

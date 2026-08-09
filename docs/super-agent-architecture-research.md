# Super Agent Architecture Research Report

## Executive Summary

A "Super Agent" for Zana Command Center should be a single persistent orchestrator that monitors multiple software projects, manages autonomous goals, and maintains conversational context. Based on current Claude API capabilities and multi-agent patterns, the recommended architecture is a **coordinator-worker pattern** using Claude Opus 4.8 (or Claude Fable 5 for highest capability) as the orchestrator, with dynamic sub-agent spawning for parallel work.

**Key Recommendation:** Use Claude's Managed Agents with a coordinator multiagent configuration, persistent memory stores, and event-driven monitoring with adaptive thinking + effort controls to manage token spend.

---

## 1. Orchestrator/Supervisor Patterns

### Managed Agents Coordinator Pattern (Primary Recommendation)

**Source:** Claude Managed Agents API documentation (`shared/managed-agents-multiagent.md`)

The Managed Agents coordinator pattern provides:

- **Persistent agent definitions** versioned and reusable across sessions
- **Multiagent coordination** with one coordinator spawning multiple subagents
- **Shared container and filesystem** across all agents in a session
- **Isolated context per thread** — each subagent runs in its own event stream with independent conversation history

**Architecture:**

```
Coordinator Agent (Opus 4.8)
├── Project Monitor Subagent (watches git/filesystem changes)
├── Goal Evaluator Subagent (checks goal completion)
├── Chat Interface Subagent (handles user conversations)
└── Task Executor Subagent(s) (parallel work execution)
```

**Key Features:**

1. **Roster declaration:** Define all available subagents in the coordinator's `multiagent.agents` array
2. **On-demand spawning:** Coordinator decides when to delegate based on workload
3. **Persistent threads:** Subagent threads survive across coordinator interactions
4. **Cross-thread messaging:** Agents can send results back asynchronously

**Code Example:**

```python
# Create coordinator with subagent roster
orchestrator = client.beta.agents.create(
    name="Super Agent Orchestrator",
    model="claude-opus-4-8",
    system="""You coordinate work across multiple software projects.
    Spawn monitor agents to watch project state.
    Spawn evaluator agents to check goal completion.
    Keep user conversations separate from background monitoring.""",
    tools=[{"type": "agent_toolset_20260401"}],
    multiagent={
        "type": "coordinator",
        "agents": [
            project_monitor_agent.id,
            goal_evaluator_agent.id,
            task_executor_agent.id,
            {"type": "self"}  # Can spawn copies of itself
        ]
    }
)
```

### Alternative: Messages API Tool-Use Loop

For tighter control and custom orchestration logic, use the standard Messages API with a tool-use loop. The coordinator runs in your application code, calling Claude for decisions but managing the work queue yourself.

**Trade-offs:**

- ✅ Full control over execution, logging, approval gates
- ✅ Can integrate with existing Zana Command Center architecture
- ❌ More implementation overhead
- ❌ Must manage container lifecycle, file mounts, and resource cleanup yourself

---

## 2. Session vs. Thread Separation for Multiple Conversations

### Memory Store + Session Threading Model

**Source:** Claude Managed Agents Memory documentation (`shared/managed-agents-memory.md`)

**Recommended Pattern:**

1. **One long-running session** for the Super Agent coordinator
2. **Multiple threads** (one per subagent) for isolated work contexts
3. **Persistent memory stores** for cross-session knowledge retention
4. **User conversation separate** from monitoring/goal-evaluation threads

**Session Structure:**

```
Super Agent Session (long-lived)
├── Primary Thread (user conversation)
├── Monitor Thread (periodic project checks)
├── Goal Thread 1 (autonomous goal pursuit)
├── Goal Thread 2 (autonomous goal pursuit)
└── Goal Thread N (autonomous goal pursuit)
```

**Memory Architecture:**

```python
# Create memory stores for different scopes
user_preferences_store = client.beta.memory_stores.create(
    name="User Preferences",
    description="User's coding preferences, project context, and interaction history"
)

project_knowledge_store = client.beta.memory_stores.create(
    name="Project Knowledge", 
    description="Learned patterns, common issues, and project-specific context"
)

goal_state_store = client.beta.memory_stores.create(
    name="Active Goals",
    description="Current goals, progress, and evaluation criteria"
)

# Attach all stores to session
session = client.beta.sessions.create(
    agent=orchestrator.id,
    environment_id=env.id,
    resources=[
        {"type": "memory_store", "memory_store_id": user_preferences_store.id},
        {"type": "memory_store", "memory_store_id": project_knowledge_store.id},
        {"type": "memory_store", "memory_store_id": goal_state_store.id}
    ]
)
```

**Memory Scoping Best Practices:**

- **Session-scoped:** Temporary working memory, cleared when session ends
- **User-scoped:** Preferences, communication style, project relationships
- **Project-scoped:** Technical context, architecture decisions, known issues
- **Global:** Cross-project patterns, reusable solutions

**Working vs. Episodic vs. Semantic Memory:**

| Memory Type | Implementation | Use Case |
|-------------|---------------|----------|
| Working | In-context messages | Current conversation state, active tool results |
| Episodic | Memory store files (`/memories/episodes/<date>.md`) | What happened in past sessions, user interactions |
| Semantic | Memory store files (`/memories/knowledge/<topic>.md`) | Learned facts, project architecture, best practices |

---

## 3. Token-Efficient Monitoring Loop Design

### Event-Driven + Cheap Triage Model

**Source:** Claude API Thinking & Effort documentation (`shared/agent-design.md`)

**Problem:** Continuous polling with a frontier model burns tokens rapidly.

**Solution:** Multi-tier monitoring with escalation.

**Monitoring Architecture:**

```
Layer 1: Filesystem watchers / Git hooks (zero tokens)
    ↓ change detected
Layer 2: Haiku 4.5 quick triage (cheap: $1/$5 per MTok)
    ↓ if interesting
Layer 3: Sonnet 5 deep analysis (moderate: $2-3/$10-15 per MTok)
    ↓ if action needed
Layer 4: Opus 4.8 decision + execution (expensive: $5/$25 per MTok)
```

**Code Example:**

```python
# Layer 1: External file watcher triggers webhook
@app.post("/project-change")
async def handle_project_change(event: ChangeEvent):
    # Layer 2: Quick triage with Haiku
    triage = await client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=256,
        thinking={"type": "disabled"},  # No thinking for triage
        output_config={"effort": "low"},
        messages=[{
            "role": "user",
            "content": f"Changed files: {event.files}. Does this need Super Agent attention? Reply YES or NO with 1 sentence why."
        }]
    )
    
    if "YES" in triage.content[0].text:
        # Layer 3: Deep analysis with Sonnet
        analysis = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=2048,
            thinking={"type": "adaptive"},
            output_config={"effort": "medium"},
            messages=[{
                "role": "user",
                "content": f"Analyze this change and determine if it affects any active goals or requires user notification."
            }]
        )
        
        # Layer 4: Orchestrator decides action
        if analysis requires orchestrator:
            await wake_super_agent(analysis)
```

**Token Budget Controls:**

```python
# Use task budgets to cap per-loop spend
response = await client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={
        "effort": "high",
        "task_budget": {"type": "tokens", "total": 32000}  # Hard cap
    },
    betas=["task-budgets-2026-03-13"],
    messages=[...]
)
```

**Polling Frequency Recommendations:**

- **High-priority projects:** Every 5 minutes with Layer 2 triage
- **Normal projects:** Every 30 minutes with Layer 2 triage  
- **Background projects:** Every 4 hours, or wake-on-git-hook only
- **User conversation:** Real-time (no polling, event-driven)

**Wake-on-Change Pattern:**

Instead of continuous polling, use:

1. **Git hooks** → POST to webhook → wake Super Agent
2. **Filesystem watchers** (inotify, FSEvents) → queue event → batch triage
3. **Scheduled deployments** (Managed Agents feature) → periodic check-ins

---

## 4. Coexistence with Normal Chat Agent

### Separation of Concerns Architecture

**Source:** Zana Command Center codebase patterns (`CLAUDE.md`, `overseer.ts`)

**Challenge:** Prevent Super Agent and normal chat from:
- Racing on shared state (inbox, goals, project metadata)
- Duplicating work (both trying to implement the same fix)
- Contradicting each other (conflicting goal edits)

**Recommended Separation:**

| Concern | Normal Chat Agent | Super Agent |
|---------|------------------|-------------|
| **User interaction** | Synchronous, conversational | Async updates via inbox |
| **Scope** | Current project tab | All registered projects |
| **Tool access** | Full read/write | Read-only on active work, write only when delegated |
| **Goals** | Cannot create or edit | Can create and update |
| **Session lifetime** | Ephemeral (per-conversation) | Long-running (days/weeks) |

**Shared State Protection:**

```typescript
// In store.ts - add lock mechanism
interface AgentLock {
  heldBy: 'chat' | 'super-agent' | null
  projectId: string
  acquiredAt: number
  operation: string
}

// Before chat agent writes to project
async function acquireProjectLock(projectId: string, agent: 'chat' | 'super-agent'): Promise<boolean> {
  const lock = await getLock(projectId)
  if (lock && lock.heldBy !== agent && Date.now() - lock.acquiredAt < 60000) {
    return false // Another agent is working on this project
  }
  await setLock(projectId, agent, Date.now())
  return true
}

// In ChatPanel.tsx - before sending to agent
const canProceed = await acquireProjectLock(currentProject.id, 'chat')
if (!canProceed) {
  showNotification("Super Agent is currently working on this project")
  return
}
```

**Goal Edit Conflict Resolution:**

```python
# Super Agent checks for active chat sessions before editing goals
def can_edit_goal(goal_id: str) -> bool:
    active_chats = get_active_chat_sessions()
    for chat in active_chats:
        if chat.project_id == goal.project_id:
            # Chat agent has priority on active projects
            return False
    return True

# Alternatively: Optimistic locking with version numbers
goal = get_goal(goal_id)
updated_goal = update_goal_content(goal)
try:
    save_goal(updated_goal, expected_version=goal.version)
except VersionMismatchError:
    # Another agent modified it, re-read and merge or abort
    handle_conflict()
```

**Communication Channel:**

Use the existing inbox system for Super Agent → user communication, but add a separate channel for Super Agent → chat agent coordination:

```typescript
// In main/index.ts - add agent coordination channel
ipcMain.handle('super-agent:notify-chat', (event, message) => {
  // Notify active chat sessions about Super Agent actions
  const activeChatWindow = getActiveChatWindow()
  if (activeChatWindow) {
    activeChatWindow.webContents.send('super-agent:activity', message)
  }
})

// In ChatPanel.tsx - show Super Agent activity
useEffect(() => {
  const handler = (event: any, message: SuperAgentNotification) => {
    if (message.projectId === currentProject.id) {
      showStatusBanner(`Super Agent: ${message.summary}`)
    }
  }
  window.cc.on('super-agent:activity', handler)
  return () => window.cc.off('super-agent:activity', handler)
}, [currentProject])
```

---

## 5. Model and Configuration Recommendations

### Model Selection by Tier

**Source:** Claude API Models documentation (`shared/models.md`)

| Use Case | Model | Effort | Max Tokens | Reasoning |
|----------|-------|--------|------------|-----------|
| **Orchestrator / Goal Decisions** | Claude Opus 4.8 | `high` or `xhigh` | 64000 | Best long-horizon autonomy, strong planning |
| **Highest-capability work** | Claude Fable 5 | `xhigh` | 128000 | Most capable for hardest problems, 30-day retention required |
| **Project Monitoring** | Claude Sonnet 5 | `medium` | 16000 | Near-Opus quality on coding tasks, cost-effective |
| **Quick Triage** | Claude Haiku 4.5 | `low` | 1024 | Fastest, cheapest for filtering |
| **User Chat Interface** | Claude Sonnet 5 | `high` | 32000 | Balanced quality/cost for conversations |

**Configuration Recommendations:**

```python
# Orchestrator configuration
ORCHESTRATOR_CONFIG = {
    "model": "claude-opus-4-8",
    "max_tokens": 64000,
    "thinking": {"type": "adaptive", "display": "omitted"},  # Think but don't show
    "output_config": {
        "effort": "xhigh",  # Highest quality decisions
        "task_budget": {"type": "tokens", "total": 50000}  # Cap per-decision
    },
    "cache_control": {"type": "ephemeral", "ttl": "1h"}  # Long cache for system prompt
}

# Goal evaluator configuration  
EVALUATOR_CONFIG = {
    "model": "claude-sonnet-5",
    "max_tokens": 16000,
    "thinking": {"type": "adaptive"},
    "output_config": {"effort": "medium"},
    "cache_control": {"type": "ephemeral"}  # 5-min cache for goal specs
}

# Monitoring triage configuration
TRIAGE_CONFIG = {
    "model": "claude-haiku-4-5", 
    "max_tokens": 512,
    "thinking": {"type": "disabled"},  # No thinking needed for yes/no
    "output_config": {"effort": "low"}
}
```

### Context Window Strategy

**All current Claude models support 1M token context** (except Haiku 4.5: 200K).

**Strategy:**

1. **Use prompt caching aggressively** for the system prompt and common project context
2. **Use compaction** for long-running sessions approaching context limits
3. **Use memory stores** to offload episodic knowledge from context

**Context Budget Allocation:**

```
Total Context: 1M tokens
├── System Prompt (cached): ~20K tokens
├── Memory Store Metadata (cached): ~10K tokens
├── Active Project Context (cached): ~50K tokens
├── Recent Conversation History: ~100K tokens
├── Active Goal Specifications: ~50K tokens
└── Working Space: ~770K tokens available
```

**Compaction Configuration:**

```python
response = await client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=64000,
    betas=["compact-2026-01-12"],
    context_management={
        "edits": [{"type": "compact_20260112"}]
    },
    messages=long_conversation_history
)

# Append full content including compaction blocks
messages.append({"role": "assistant", "content": response.content})
```

### Tool-Use Loop Shape

**Recommended:** Use the **Tool Runner** for automatic loop handling.

```python
from anthropic import Anthropic
from anthropic.lib.tools.beta import beta_tool

# Define tools as decorated functions
@beta_tool
def check_project_status(project_id: str) -> dict:
    """Check the current status of a project."""
    return get_project_status(project_id)

@beta_tool  
def update_goal_progress(goal_id: str, progress: int, notes: str) -> dict:
    """Update progress on an active goal."""
    return update_goal(goal_id, progress, notes)

# Tool runner handles the agentic loop automatically
client = Anthropic()
result = client.beta.messages.tool_runner(
    model="claude-opus-4-8",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "xhigh"},
    tools=[check_project_status, update_goal_progress],
    messages=[{"role": "user", "content": "Check all active goals and update progress"}]
)
```

---

## 6. Implementation Roadmap

### Phase 1: Proof of Concept (Week 1-2)

1. ✅ Set up Managed Agents coordinator with 2-3 simple subagents
2. ✅ Implement memory stores for goal state and project knowledge
3. ✅ Create basic monitoring loop (polling-based, no triage yet)
4. ✅ Test thread separation with simultaneous user chat + background monitoring

**Success Criteria:** Super Agent can maintain one goal across multiple projects while user has normal chat conversations.

### Phase 2: Token Optimization (Week 3-4)

1. ✅ Add Haiku triage layer before expensive model calls
2. ✅ Implement task budgets on all Opus calls
3. ✅ Set up prompt caching for system prompt and project context
4. ✅ Add compaction for long-running sessions

**Success Criteria:** Token spend reduced by 70%+ compared to Phase 1 while maintaining quality.

### Phase 3: Coexistence & Polish (Week 5-6)

1. ✅ Implement project lock mechanism to prevent race conditions
2. ✅ Add Super Agent activity notifications to chat interface
3. ✅ Create goal conflict resolution system
4. ✅ Polish inbox integration for Super Agent → user communication

**Success Criteria:** No observable conflicts or duplicated work between chat and Super Agent.

### Phase 4: Scale & Monitoring (Week 7-8)

1. ✅ Scale to monitoring 10+ projects simultaneously
2. ✅ Add metrics dashboard for token spend and goal progress
3. ✅ Implement alert system for stuck goals or anomalies
4. ✅ Load testing and optimization

**Success Criteria:** Stable operation with 10+ projects, <$5/day token spend.

---

## 7. References and Further Reading

### Primary Sources

All recommendations based on official Anthropic documentation:

- **Managed Agents Overview:** Claude Platform documentation, Managed Agents API reference
- **Multiagent Patterns:** `shared/managed-agents-multiagent.md` in claude-api skill
- **Memory Architecture:** `shared/managed-agents-memory.md` in claude-api skill  
- **Agent Design Patterns:** `shared/agent-design.md` in claude-api skill
- **Token Optimization:** `shared/prompt-caching.md` and effort parameter documentation
- **Model Capabilities:** `shared/models.md` and Models API endpoint

### Related Patterns

- **LangGraph Supervisor Pattern:** Multi-agent system with central supervisor (similar coordinator role)
- **Anthropic's Claude Agent SDK:** Developer-facing SDK for building agents (superseded by Managed Agents for hosted solutions)
- **OpenAI Swarm:** Lightweight multi-agent orchestration (similar handoff patterns but client-hosted)

### Zana Command Center Integration Points

- Leverage existing Overseer (`src/main/overseer.ts`) as monitoring foundation
- Extend Inbox system (`mcp-server.ts` inbox tools) for Super Agent communication  
- Use existing persona/team registry (`persona-store.ts`) for subagent definitions
- Build on library system (`.zcc/library/`) for persistent knowledge storage

---

## Appendix A: Token Cost Analysis

### Monitoring Loop Cost Projection

**Assumptions:**
- 10 active projects
- Check every 5 minutes (288 checks/day)
- 90% filtered by Haiku triage
- 10% escalated to Sonnet analysis
- 1% escalated to Opus action

**Daily Token Spend:**

| Layer | Checks/Day | Tokens/Check | Cost/1M | Daily Cost |
|-------|------------|--------------|---------|------------|
| Haiku Triage | 2,880 (10 projects × 288) | 500 | $1 input | $1.44 |
| Sonnet Analysis | 288 (10% escalation) | 8,000 | $2 input | $4.61 |
| Opus Action | 29 (1% escalation) | 32,000 | $5 input | $4.64 |
| **Total** | | | | **~$10.69/day** |

**With optimizations** (batching, better filtering, 1-hour cache):
- **~$3-5/day** for 10 projects

### Goal Evaluation Cost

**Per-goal daily check:**
- Input: 10K tokens (goal spec + project context cached)
- Output: 2K tokens (evaluation result)
- Model: Sonnet 5 @ $2/$10 per MTok
- Cost: **$0.04/goal/day**

**10 active goals = $0.40/day**

---

## Appendix B: Prompt Templates

### Orchestrator System Prompt

```markdown
You are the Super Agent orchestrator for a multi-project development environment.

RESPONSIBILITIES:
- Monitor registered projects for changes requiring attention
- Manage autonomous goals (create, update, evaluate completion)
- Coordinate with subagent specialists for parallel work
- Communicate important updates to the user via inbox

CONSTRAINTS:
- Do NOT take action on projects with active user chat sessions (check before acting)
- Do NOT edit goals that were modified by the user in the last 10 minutes
- Keep user notifications concise and actionable
- Default to async/background work; only interrupt user for urgent issues

SUBAGENTS AVAILABLE:
- Project Monitor: watches filesystem and git changes
- Goal Evaluator: checks goal completion criteria
- Task Executor: performs coding/refactoring work
- Self: spawn copies for parallel goal pursuit

MEMORY STORES:
- /mnt/memory/user-preferences/: user coding preferences, project relationships
- /mnt/memory/project-knowledge/: technical context, known issues, architecture
- /mnt/memory/active-goals/: goal definitions, progress, evaluation criteria

MONITORING STRATEGY:
Before checking a project, consult /mnt/memory/project-knowledge/<project-id>/last-check.md
Only deep-analyze if changes are significant (use "git diff --stat" for quick assessment)
```

### Goal Evaluator System Prompt

```markdown
You evaluate whether autonomous goals have been achieved.

INPUT:
- Goal specification with success criteria
- Current project state (filesystem, git history, test results)
- Previous evaluation results (if any)

OUTPUT:
Return a structured evaluation:
- progress: 0-100 (percentage complete)
- status: "in_progress" | "blocked" | "complete" | "needs_revision"
- evidence: concrete facts supporting your assessment (file changes, test results, etc.)
- next_steps: what should happen next (if incomplete)
- blockers: what's preventing progress (if blocked)

IMPORTANT:
- Only mark "complete" if ALL success criteria are met with evidence
- Be specific about what's missing if incomplete
- Identify root causes for blockers, not just symptoms
```

---

## Conclusion

The recommended Super Agent architecture for Zana Command Center is:

1. **Managed Agents coordinator-worker pattern** with Claude Opus 4.8 as orchestrator
2. **Tiered monitoring** (filesystem → Haiku triage → Sonnet analysis → Opus action)
3. **Memory stores** for persistent knowledge across sessions
4. **Strict separation** from normal chat agent via locking and scoped tool access
5. **Task budgets and prompt caching** for token optimization

This architecture provides:
- ✅ Single persistent orchestrator monitoring multiple projects
- ✅ Multiple concurrent conversations via thread separation
- ✅ Token-efficient monitoring via tiered escalation
- ✅ Safe coexistence with normal chat through conflict prevention
- ✅ Concrete model/config recommendations for each component

**Estimated operational cost:** $5-10/day for 10 active projects with continuous monitoring.

**Next step:** Begin Phase 1 proof of concept with 2-3 projects and basic coordinator.

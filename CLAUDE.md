# Agent Teams

A new approach to task management with AI agent teams. Assemble agent teams with different roles that work autonomously in parallel, communicate with each other, create and manage their own tasks, review code, and collaborate across teams. You manage everything through a kanban board — like a CTO with an AI engineering team.

Key capabilities:
- **Agent Teams** — create teams with roles, agents work autonomously in parallel
- **Cross-team communication** — agents message each other within and across teams
- **Kanban board** — tasks change status in real-time as agents work
- **Code review** — diff view per task (accept/reject/comment), similar to Cursor
- **Solo mode** — single agent with self-managed tasks, expandable to full team
- **Live process section** — see running agents, open URLs in browser
- **Direct messaging** — send messages to any agent, comment on tasks, add quick actions on kanban cards
- **Deep session analysis** — bash commands, reasoning, subprocesses breakdown
- **Context monitoring** — token usage by category (CLAUDE.md, tool outputs, thinking, team coordination)
- **Built-in code editor** — edit files with Git support without leaving the app
- **MCP integration** — built-in mcp-server for external tools and agent plugins
- **Post-compact context recovery** — restores team-management instructions after context compaction
- **Notification system** — alerts on task completion, agent attention needed, errors
- **Zero-setup onboarding** — built-in runtime detection and provider authentication for Claude, Codex, and OpenCode

100% free, open source, and local-first. The app uses available Claude/Codex/OpenCode provider access instead of forcing a single app-level API-key setup.

## Tech Stack
Electron 40.x, React 19.x, TypeScript 5.x, Tailwind CSS 3.x, Zustand 4.x

## Commands
Always use pnpm (not npm/yarn) for this project.
Workspace membership is canonical in `pnpm-workspace.yaml`; do not re-add root `package.json.workspaces`, because npm subproject installs in Codex Cloud must treat nested packages as standalone projects.
Do NOT run `pnpm lint:fix` unless the user explicitly asks for it — it interferes with agents running in parallel.
When running build/typecheck/test commands, pipe through `tail -20` to avoid flooding the context window (e.g. `pnpm typecheck 2>&1 | tail -20`).
- Hard guardrails: [`AGENT_CRITICAL_GUARDRAILS.md`](AGENT_CRITICAL_GUARDRAILS.md)

- `pnpm install` - Install dependencies
- `pnpm dev` - Desktop Electron app with hot reload
- `pnpm build` - Production build
- `pnpm typecheck` - Canonical type check using the project's pinned native TypeScript 7 compiler (do not additionally run global `tsc7`)
- `pnpm lint:fix` - Lint and auto-fix
- `pnpm format` - Format code
- `pnpm test` - Run all vitest tests
- `pnpm test:watch` - Watch mode
- `pnpm test:coverage` - Coverage report
- `pnpm test:coverage:critical` - Critical path coverage
- `pnpm test:chunks` - Chunk building tests
- `pnpm test:semantic` - Semantic step extraction tests
- `pnpm test:noise` - Noise filtering tests
- `pnpm test:task-filtering` - Task tool filtering tests
- `pnpm check` - Full quality gate (types + lint + test + build)
- `pnpm fix` - Lint fix + format
- `pnpm quality` - Full check + format check + knip

## Git commits
Use normal, human-readable messages. Do not add tool-attribution trailers (for example `Made-with: …`) to commit messages.

## Path Aliases
Use path aliases for imports:
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`
- `@preload/*` → `src/preload/*`

## Features Architecture
**All new medium and large features should follow the canonical slice standard in [`docs/FEATURE_ARCHITECTURE_STANDARD.md`](docs/FEATURE_ARCHITECTURE_STANDARD.md).**

Default location:
- `src/features/<feature-name>/`

Reference implementation:
- `src/features/recent-projects`

Feature-local guidance:
- `src/features/CLAUDE.md`

Legacy note:
- `src/renderer/features/*` still exists for older renderer-only slices
- do not use `src/renderer/features/*` as the default for new cross-process features
- thin renderer-only slices may still stay local when they do not need `core/`, transport wiring, or multi-process boundaries

## Data Sources
~/.claude/projects/{encoded-path}/*.jsonl - Session files
~/.claude/todos/{sessionId}.json - Todo data

Path encoding: `/Users/name/project` → `-Users-name-project`

## Critical Concepts

### Agent Blocks
- Use `wrapAgentBlock(text)` from `@shared/constants/agentBlocks` to wrap agent-only content.
  Do NOT manually concatenate `AGENT_BLOCK_OPEN/CLOSE` — the wrapper handles trimming and formatting.
- `stripAgentBlocks(text)` — removes agent blocks for UI display
- `unwrapAgentBlock(block)` — extracts content from a single block
- Agent blocks are hidden from the user in UI, used for internal instructions between agents.

### isMeta Flag
- `isMeta: false` = Real user message (creates new chunks)
- `isMeta: true` = Internal message (tool results, system-generated)

### Chunk Structure
Independent chunk types for timeline visualization:
- **UserChunk**: Single user message with metrics
- **AIChunk**: All assistant responses with tool executions and spawned subagents
- **SystemChunk**: Command output/system messages
- **CompactChunk**: System metadata/structural messages

Each chunk has: timestamp, duration, metrics (tokens, cost, tools)

### Task/Subagent Filtering
Task tool_use blocks are filtered when subagent exists
Keep orphaned Task calls (no matching subagent) for visibility.

### Agent Teams
Agent Teams is this app's orchestration layer across Claude, Codex, and OpenCode runtimes.
For Claude runtime behavior, also track Anthropic's upstream agent-team docs: https://code.claude.com/docs/en/agent-teams

#### Runtime Routing
- **Per-run routing lives in `resolveTeamRuntimeMode` (`src/main/services/team/provisioning/resolveTeamRuntimeMode.ts`)**: the fork runs only on explicit `CLAUDE_TEAM_CLI_FLAVOR=agent_teams_orchestrator`; under the stock default, a **Codex lead routes to stock codex lanes** and everything else routes to stock Claude. A Codex team never silently falls back to the Claude binary.

#### Stock Codex Lane Runtime
- When the team provider is Codex (stock flavor), **every member — lead included — runs as its own interactive stock `codex` TUI** in a window of one tmux session (`CodexTeamLanesService` in `src/features/interactive-team-runtime/main/`). The app is the team fabric: codex-native multi-agent (`spawn_agent`) is threads-in-one-process with no panes/mailboxes, so it is only used by members for private subagents.
- Lanes get the agent-teams MCP server via stock `-c mcp_servers.agent_teams.*` overrides (`buildCodexLaneArgs` + `buildAgentTeamsMcpServerSpec`); coordination uses the same kanban/message tools as Claude teams. Server name is underscored (`agent_teams`); tool names are unqualified in codex.
- **Inbound delivery is paste-based**: `CodexLaneMessagePump` (TeamProvisioningService) pastes unread app-inbox messages into the recipient's pane as `[Agent Teams message from <name>]` and marks them read (codex queues pasted input even mid-turn). User DMs go direct via `deliverCodexLaneDm` with the pump as retry net.
- Pane-state detection (`codexPaneState.ts`) must anchor on the LAST non-empty lines — the codex TUI redraws below old output, so dialogs stay in the capture forever. Trust dialogs are auto-answered; `-c projects."<cwd>".trust_level` does NOT suppress them.
- Binding is `interactive-runtime.json` v2 (`runtime: 'codex-lanes'`, `lanes[]`); consoles/stop/status dispatch on `binding.runtime`. Stop sends `/quit` per lane. Codex members without explicit models inherit the user's `~/.codex/config.toml` default (never call the fork-only `model list` control plane). No headless fallback: tmux/win32 ineligibility fails the run.

#### Claude Runtime Flavors
- **Default flavor is `claude` (stock Claude Code CLI)** — `DEFAULT_CLI_FLAVOR` in `src/main/services/team/cliFlavor.ts`. The bundled multimodel fork (`claude-multimodel`) is opt-in via `CLAUDE_TEAM_CLI_FLAVOR=agent_teams_orchestrator` and still required for Gemini/OpenCode providers (Codex now runs stock — see above).
- **Stock teams launch INTERACTIVE in tmux by default** (`src/features/interactive-team-runtime/`): the lead is a real interactive Claude session in an app-created tmux session (`agteams-<team>-<run8>`), teammates get their own panes broken out into named windows, and member consoles attach via PTY + `tmux attach`. Headless `--print` is the automatic fallback (no tmux, win32, or `AGENT_TEAMS_DISABLE_INTERACTIVE_RUNTIME=1`).
- Stock launches strip the fork's routing env (`stripMultimodelRoutingEnv` — `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` makes stock refuse its keychain login), set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, skip the fork-only `--team-bootstrap-spec` flags, and deliver the roster as a bootstrap prompt (stdin for headless, tmux paste-buffer for interactive).
- Interactive runs have **no child process**: aliveness comes from `runtimeAdapterRunByTeam`, readiness from watching the stock session-derived team dir (`~/.claude/teams/session-<lead8>/`), and member bootstrap confirmation from runtime registration. Known limitation: app quit stops interactive teams (restart adoption not yet built).
- The stock runtime writes its own team state under a SESSION-DERIVED name (`session-` + first 8 chars of lead session id), separate from the app team dir. `StockSessionTeamBridge` (`src/main/services/team/provisioning/`) maps between them and delivers DMs directly into stock mailbox files.

#### Debugging Team Launches And Teammates
- Use [`docs/team-management/debugging-agent-teams.md`](docs/team-management/debugging-agent-teams.md) when a team launch hangs, a teammate remains `registered`, OpenCode shows `bootstrap unconfirmed`, messages are missing, or Task Log Stream looks wrong.
- Always correlate UI diagnostics with persisted files under `~/.claude/teams/<teamName>/`, live process state, and runtime-specific evidence before changing code.
- For OpenCode secondary lanes, do not confuse primary filesystem readiness with lane bootstrap readiness. A missing OpenCode inbox during primary launch is not automatically a bug.
- Do not treat `member_briefing` as runtime evidence. OpenCode deliverability requires lane-scoped committed runtime evidence such as `opencode-sessions.json` plus its manifest entry.

#### Message Delivery Architecture
- **Fork lead (headless)** reads ONLY stdin (stream-json). Messages to lead go through `relayLeadInboxMessages()` which converts inbox entries to stdin. **Stock interactive leads have no app-owned stdin** — lead DMs deliver via the stock session mailbox (`deliverStockTeammateDm` with the lead name); the stdin path remains for headless.
- **Fork native teammates** are independent CLI/process teammates that read their own inbox files between turns; no relay through the lead is needed.
- **Stock teammates**: interactive-mode teammates consume the stock session mailbox (`session-<lead8>/inboxes/<member>.json`) — the app writes DMs there directly via `StockSessionTeamBridge`. Headless stock teammates are in-process subagents that read NO inbox files; DMs relay through the lead via `relayMemberInboxMessages` (re-enabled for stock headless only) plus a periodic relay poll.
- **OpenCode secondary lanes** do not watch teammate inbox files. User DMs are persisted to `inboxes/{member}.json`, then delivered through the OpenCode runtime bridge with explicit delivery proof.
- **User → Teammate DM**: UI writes to `inboxes/{member}.json` with `from: "user"`. Delivery then depends on the runtime (see above); on confirmed delivery the app-side copy is marked `read`, which drives the UI's delivering→delivered state.
- **Teammate → User response**: Teammate writes to `inboxes/user.json` or uses the runtime-specific Agent Teams message tool that persists there. UI reads all inbox files including `user.json` via `TeamInboxReader`.
- **`relayMemberInboxMessages` is disabled for FORK teammates** (lead replies, duplicate messages, relay loops) but is the active fallback for stock headless teams where the lead is the only delivery channel.
- **`relayLeadInboxMessages` is ACTIVE for headless leads** - they read stdin, not inbox files.
- Messages in `user.json` may lack `messageId` - `TeamInboxReader` generates deterministic IDs via sha256(from+timestamp+text).
- See `docs/team-management/research-messaging.md` for full architecture details.

#### Team Protocol Details
- **Process.team?** `{ teamName, memberName, memberColor }` — enriched by SubagentResolver from Task call inputs and `teammate_spawned` tool results
- **Teammate messages** arrive as `<teammate-message teammate_id="..." color="..." summary="...">content</teammate-message>` in user messages (isMeta: false). Detected by `isParsedTeammateMessage()` — excluded from UserChunks, rendered as `TeammateMessageItem` cards
- **Session ongoing detection** treats `SendMessage` shutdown_response (approve: true) and its tool_result as ending events, not ongoing activity
- **Display summary** counts distinct teammates (by name) separately from regular subagents
- **Team tools**: TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, TeamDelete — have readable summaries in `toolSummaryHelpers.ts`

### Structured Task References
- **TaskRef**: `{ taskId, displayId, teamName }` — shared typed reference used to persist task mentions across UI and storage
- **Persisted optional fields**: `InboxMessage.taskRefs`, `TaskComment.taskRefs`, `TeamTask.descriptionTaskRefs`, `TeamTask.promptTaskRefs`
- **Request surfaces**: `SendMessageRequest.taskRefs`, `AddTaskCommentRequest.taskRefs`, `CreateTaskRequest.descriptionTaskRefs`, `CreateTaskRequest.promptTaskRefs`, `UpdateKanbanPatch` `request_changes.taskRefs`
- **Renderer flow**: task-aware inputs use `useTaskSuggestions()` with `taskReferenceUtils.ts` to extract refs from text; encoded zero-width metadata preserves exact task identity while keeping visible text readable
- **Main/IPC flow**: `src/main/ipc/teams.ts` and `src/main/ipc/crossTeam.ts` validate structured refs before `TeamDataService`, inbox stores, task stores, and readers persist/rehydrate them
- **Rendering/navigation**: `linkifyTaskIdsInMarkdown()` and `parseTaskLinkHref()` turn persisted refs into stable `task://` links across messages, comments, task descriptions, and activity items

### Visible Context Tracking
Tracks what consumes tokens in Claude's context window across 6 categories (discriminated union on `category` field):

| Category | Type | Source |
|----------|------|--------|
| `claude-md` | `ClaudeMdContextInjection` | CLAUDE.md files (global, project, directory) |
| `mentioned-file` | `MentionedFileInjection` | User @-mentioned files |
| `tool-output` | `ToolOutputInjection` | Tool execution results (Read, Bash, etc.) |
| `thinking-text` | `ThinkingTextInjection` | Extended thinking + text output tokens |
| `team-coordination` | `TeamCoordinationInjection` | Team tools (SendMessage, TaskCreate, etc.) |
| `user-message` | `UserMessageInjection` | User prompt text per turn |

- **Types**: `src/renderer/types/contextInjection.ts` — `ContextInjection` union, `ContextStats`, `TokensByCategory`
- **Tracker**: `src/renderer/utils/contextTracker.ts` — `computeContextStats()`, `processSessionContextWithPhases()`
- **Context Phases**: Compaction events reset accumulated injections, tracked via `ContextPhaseInfo`
- **Display surfaces**: `ContextBadge` (per-turn popover), `TokenUsageDisplay` (hover breakdown), `SessionContextPanel` (full panel)

## Error Handling
- Main: try/catch, console.error, return safe defaults
- Renderer: error state in Zustand store
- IPC: parameter validation, graceful degradation

## Performance
- LRU Cache: Avoid re-parsing large JSONL files
- Streaming JSONL: Line-by-line processing
- Virtual Scrolling: For large session/message lists
- Debounced File Watching: 100ms debounce

## Troubleshooting

### Build Issues
```bash
rm -rf dist dist-electron node_modules
pnpm install
pnpm build
```

### Type Errors
```bash
pnpm typecheck
```

### Test Failures
Check for changes in message parsing or chunk building logic.

### Packaged app: CLI / “Not logged in”
Each successful run of **`CliInstallerService.getStatus()`** tries to append one NDJSON line to **`claude-cli-auth-diag.ndjson`** (field **`diagFile`**: full path). Typical location: Electron **`app.getPath('logs')`** — on macOS often `~/Library/Logs/<product name>/` (exact folder is OS- and build-specific). If the file exceeds **512 KiB**, it is **truncated to empty** before the next append (avoids unbounded growth). **No line is written** if the app is not under Electron, log dir cannot be resolved, or disk write fails. **IPC** (`cliInstaller:getStatus`) **dedupes** work for **5s** (`STATUS_CACHE_TTL_MS` in `src/main/ipc/cliInstaller.ts`), so rapid UI polls do **not** each trigger a new file append. Default logger hides `info`/`warn` in production; **`logger.error`** still goes to the console (e.g. if assembling the diag line throws — should be rare).

## TypeScript Conventions

### Naming
| Category | Convention | Example |
|----------|------------|---------|
| Services/Components | PascalCase | `ProjectScanner.ts` |
| Utilities | camelCase | `pathDecoder.ts` |
| Constants | UPPER_SNAKE_CASE | `PARALLEL_WINDOW_MS` |
| Type Guards | isXxx | `isParsedRealUserMessage()` |
| Builders | buildXxx | `buildChunks()` |
| Getters | getXxx | `getResponses()` |

### Type Guards
```typescript
// Message type guards (src/main/types/messages.ts)
isParsedRealUserMessage(msg)      // isMeta: false, string content
isParsedInternalUserMessage(msg)  // isMeta: true, array content
isAssistantMessage(msg)           // type: "assistant"

// Chunk type guards
isUserChunk(chunk)          // type: "user"
isAIChunk(chunk)            // type: "ai"
isSystemChunk(chunk)        // type: "system"
isCompactChunk(chunk)       // type: "compact"

// Context injection type guards (component-scoped in ContextBadge.tsx, not exported)
isClaudeMdInjection(inj)          // category: "claude-md"
isMentionedFileInjection(inj)     // category: "mentioned-file"
isToolOutputInjection(inj)        // category: "tool-output"
isThinkingTextInjection(inj)      // category: "thinking-text"
isTeamCoordinationInjection(inj)  // category: "team-coordination"
isUserMessageInjection(inj)       // category: "user-message"
```

### Barrel Exports
`src/main/services/` and its domain subdirectories have barrel exports via index.ts:
```typescript
// Preferred
import { ChunkBuilder, ProjectScanner } from './services';
// Also valid
import { ChunkBuilder } from './services/analysis';
```
Note: renderer utils/hooks/types do NOT have barrel exports — import directly from files.

### Import Order
1. External packages
2. Path aliases (@main, @renderer, @shared)
3. Relative imports

### Storage And Persistence
- New persistence flows should depend on small repository/storage abstractions, not directly on `localStorage`, `IndexedDB`, Electron APIs, or JSON files from UI components/hooks.
- Keep persistence concerns split by responsibility: schema/normalization, repository interface, concrete storage implementation, and UI adapter logic should live in separate modules.
- Prefer designs where the high-level feature code can swap local browser/Electron storage for a server-backed implementation without rewriting the rendering layer.
- Reuse generic persistence/layout infrastructure when adding new draggable/resizable surfaces instead of copying feature-specific storage code.

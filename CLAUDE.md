# Claude Flow V3 — Agent Constitution

## Behavioral Rules (Always Enforced)

Do what has been asked; nothing more, nothing less.
NEVER create files unless absolutely necessary. ALWAYS prefer editing existing files.
NEVER proactively create documentation files (*.md) or README files unless explicitly requested.
NEVER save working files, text, markdown, or tests to the root folder.
After spawning a swarm, wait for results. Do not continuously check status.

## File Organization

NEVER save to the root folder. Use these directories:
- `/src` — Source code
- `/tests` — Test files
- `/docs` — Documentation (only when requested)
- `/config` — Configuration
- `/scripts` — Utility scripts
- `/examples` — Example code

## Concurrency Rule

ALL related operations MUST be batched in a SINGLE message:
- Multiple file reads/writes/edits → one message
- Multiple Bash commands → one message
- Multiple Task tool agent spawns → one message
- TodoWrite with all items → one call

## Swarm Orchestration

**Auto-invoke swarm when task involves 3+ files, new features, cross-module refactoring, API changes with tests, security changes, or performance optimization.**

Skip swarm for: single file edits, 1-2 line fixes, doc updates, config changes, questions.

When spawning a swarm, use in ONE message:
1. MCP/CLI to initialize coordination (hierarchical topology, max 8 agents, specialized strategy)
2. Task tool to spawn real working agents in parallel
3. MCP coordinates strategy; Task tool agents execute work

Agent routing by task type:
| Task | Agents | Topology |
|------|--------|----------|
| Bug fix | researcher, coder, tester | mesh |
| Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | mesh |
| Performance | researcher, perf-engineer, coder | hierarchical |
| Security | coordinator, security-architect, auditor | hierarchical |

## Model Routing (3-Tier)

| Complexity | Handler | When |
|------------|---------|------|
| Trivial | Agent Booster / Edit tool | var→const, add-types, remove-console (skip LLM) |
| Low | haiku | Formatting, simple fixes, docs |
| Medium | sonnet | Features, refactoring, debugging |
| High | opus | Architecture, system design, security |

Check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents.

## Project Configuration

- **Monorepo**: Node.js 20+, TypeScript 5.3+, ESM
- **Topology**: hierarchical (anti-drift)
- **Consensus**: raft
- **Memory**: hybrid (SQLite + AgentDB), HNSW-indexed
- **Packages**: `@claude-flow/cli`, `@claude-flow/guidance`, `@claude-flow/hooks`, `@claude-flow/memory`, `@claude-flow/shared`, `@claude-flow/security`
- **Governance**: `@claude-flow/guidance` — compile, retrieve, enforce, prove, evolve (see `v3/@claude-flow/guidance/`)

## Key CLI Commands

```bash
npx claude-flow@v3alpha init --wizard          # Initialize project
npx claude-flow@v3alpha swarm init --v3-mode   # Start swarm
npx claude-flow@v3alpha agent spawn -t coder   # Spawn agent
npx claude-flow@v3alpha memory search -q "..."  # Search memory
npx claude-flow@v3alpha doctor --fix           # Diagnostics
npx claude-flow@v3alpha security scan          # Security scan
```

## MCP Setup

```bash
claude mcp add claude-flow npx claude-flow@v3alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start        # Optional
claude mcp add flow-nexus npx flow-nexus@latest mcp start # Optional
```

## Publishing to npm

**When publishing CLI changes, ALWAYS publish BOTH packages + update ALL tags:**

1. Build and publish `@claude-flow/cli` with `--tag alpha`, then add `latest` tag
2. Publish `claude-flow` umbrella with `--tag v3alpha`, then add `latest` and `alpha` tags
3. Verify with `npm view <pkg> dist-tags --json` for BOTH packages

Tags that MUST be updated: `@claude-flow/cli` (alpha, latest), `claude-flow` (alpha, latest, v3alpha).

The umbrella `alpha` tag is most commonly forgotten — users run `npx claude-flow@alpha`.

## Claude Code vs MCP/CLI

- **Claude Code** executes: Task tool agents, file ops, code generation, Bash, git
- **MCP/CLI** coordinates: swarm init, agent types, task orchestration, memory, hooks

**KEY**: MCP coordinates strategy, Claude Code's Task tool executes with real agents.

#!/bin/bash
# Claude Flow V3 - Intelligent Guidance Hooks
# Provides actionable context to Claude for optimal development decisions
#
# Key mechanisms:
# - Exit 0 + stdout = Context added to Claude's view
# - Exit 2 + stderr = Block with explanation
# - JSON additionalContext = Discrete guidance Claude follows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GUIDANCE_DIR="$PROJECT_ROOT/.claude-flow/guidance"
PATTERNS_DB="$PROJECT_ROOT/.claude-flow/learning/patterns.db"
METRICS_DIR="$PROJECT_ROOT/.claude-flow/metrics"

mkdir -p "$GUIDANCE_DIR" "$METRICS_DIR"

# =============================================================================
# SESSION START - Load project context for all subsequent reasoning
# =============================================================================
session_context() {
  cat << 'EOF'
## V3 Development Context

**Architecture**: Domain-Driven Design with 15 @claude-flow modules
**Priority**: Security-first (CVE-1, CVE-2, CVE-3 remediation)
**Performance Targets**:
- HNSW search: 150x-12,500x faster
- Flash Attention: 2.49x-7.47x speedup
- Memory: 50-75% reduction

**Active Patterns**:
- Use TDD London School (mock-first)
- Event sourcing for state changes
- agentic-flow@alpha as core foundation
- Bounded contexts with clear interfaces

**Code Quality Rules**:
- Files under 500 lines
- No hardcoded secrets
- Input validation at boundaries
- Typed interfaces for all public APIs
EOF

  # Add recent activity if available
  if [ -f "$METRICS_DIR/recent-activity.json" ]; then
    echo ""
    echo "**Recent Session Activity**:"
    cat "$METRICS_DIR/recent-activity.json" 2>/dev/null | head -10
  fi

  # Add learned patterns count
  if [ -f "$PATTERNS_DB" ]; then
    local count=$(sqlite3 "$PATTERNS_DB" "SELECT COUNT(*) FROM short_term_patterns" 2>/dev/null || echo "0")
    echo ""
    echo "**Learned Patterns**: $count available for reference"
  fi

  exit 0
}

# =============================================================================
# USER PROMPT - Inject relevant context before Claude processes
# =============================================================================
user_prompt_context() {
  local prompt="$1"

  # Detect intent and provide targeted guidance
  local guidance=""

  # Security-related prompts
  if echo "$prompt" | grep -qiE "(auth|security|password|token|secret|cve|vuln)"; then
    guidance="$guidance
**Security Guidance**:
- Validate all inputs at system boundaries
- Use parameterized queries (no string concatenation)
- Store secrets in environment variables only
- Apply principle of least privilege
- Check OWASP Top 10 patterns"
  fi

  # Performance-related prompts
  if echo "$prompt" | grep -qiE "(optim|perf|fast|slow|memory|cache|speed)"; then
    guidance="$guidance
**Performance Guidance**:
- Use HNSW for vector search (not brute-force)
- Batch database operations
- Implement caching at appropriate layers
- Profile before optimizing
- Target: <1ms for searches, <100ms for operations"
  fi

  # Testing-related prompts
  if echo "$prompt" | grep -qiE "(test|spec|mock|assert|coverage)"; then
    guidance="$guidance
**Testing Guidance (TDD London School)**:
- Write test first, then implementation
- Mock external dependencies
- Test behavior, not implementation
- One assertion per test concept
- Use descriptive test names"
  fi

  # Architecture-related prompts
  if echo "$prompt" | grep -qiE "(architect|design|struct|refactor|module|domain)"; then
    guidance="$guidance
**Architecture Guidance (DDD)**:
- Respect bounded context boundaries
- Use domain events for cross-module communication
- Keep domain logic in domain layer
- Infrastructure adapters for external services
- Follow ADR decisions (ADR-001 through ADR-010)"
  fi

  # Error/bug fixing prompts
  if echo "$prompt" | grep -qiE "(fix|bug|error|issue|broken|fail)"; then
    guidance="$guidance
**Debugging Guidance**:
- Reproduce the issue first
- Check recent changes in git log
- Add logging before fixing
- Write regression test
- Verify fix doesn't break other tests"
  fi

  # If we have guidance, output it
  if [ -n "$guidance" ]; then
    echo "$guidance"
  fi

  # Search for relevant learned patterns
  if [ -f "$PATTERNS_DB" ] && command -v sqlite3 &>/dev/null; then
    # Extract keywords from prompt
    local keywords=$(echo "$prompt" | tr '[:upper:]' '[:lower:]' | grep -oE '\b[a-z]{4,}\b' | head -5 | tr '\n' '|' | sed 's/|$//')
    if [ -n "$keywords" ]; then
      local patterns=$(sqlite3 "$PATTERNS_DB" "SELECT strategy FROM short_term_patterns WHERE strategy LIKE '%${keywords%|}%' ORDER BY quality DESC LIMIT 3" 2>/dev/null)
      if [ -n "$patterns" ]; then
        echo ""
        echo "**Relevant Learned Patterns**:"
        echo "$patterns" | while read -r p; do echo "- $p"; done
      fi
    fi
  fi

  exit 0
}

# =============================================================================
# PRE-EDIT - Validate and guide before file modifications
# =============================================================================
pre_edit_guidance() {
  local file_path="$1"
  local tool_name="${2:-Edit}"

  # Security checks
  if echo "$file_path" | grep -qE "\.(env|pem|key|secret|credentials)"; then
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Security: Cannot edit credential files directly. Use environment variables instead."}}'
    exit 0
  fi

  # Check for production paths
  if echo "$file_path" | grep -qE "(prod|production|live)"; then
    cat << EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This appears to be a production file. Confirm this edit is intentional."}}
EOF
    exit 0
  fi

  # Provide file-specific guidance
  local guidance=""

  case "$file_path" in
    *test*.ts|*spec*.ts)
      guidance="Testing file: Use TDD London School patterns. Mock dependencies, test behavior not implementation."
      ;;
    *security*|*auth*)
      guidance="Security module: Validate inputs, use parameterized queries, no hardcoded secrets."
      ;;
    *memory*|*cache*)
      guidance="Memory module: Consider HNSW indexing, batch operations, proper cleanup."
      ;;
    *swarm*|*coordinator*)
      guidance="Swarm module: Use event-driven communication, handle failures gracefully, respect bounded contexts."
      ;;
    *.ts)
      guidance="TypeScript: Use strict types, avoid any, export interfaces for public APIs."
      ;;
  esac

  if [ -n "$guidance" ]; then
    cat << EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"$guidance"}}
EOF
  fi

  exit 0
}

# =============================================================================
# POST-EDIT - Provide feedback and course correction
# =============================================================================
post_edit_feedback() {
  local file_path="$1"
  local success="${2:-true}"

  # Record the edit for learning
  if [ -f "$SCRIPT_DIR/learning-hooks.sh" ]; then
    "$SCRIPT_DIR/learning-hooks.sh" store "Edit: $file_path" code 0.7 2>/dev/null || true
  fi

  # Check for common issues in edited file
  if [ -f "$file_path" ]; then
    local issues=""

    # Check for console.log in non-test files
    if ! echo "$file_path" | grep -qE "(test|spec)" && grep -q "console.log" "$file_path" 2>/dev/null; then
      issues="$issues\n- Remove console.log statements (use proper logging)"
    fi

    # Check for TODO/FIXME
    if grep -qE "(TODO|FIXME|HACK)" "$file_path" 2>/dev/null; then
      issues="$issues\n- Address TODO/FIXME comments before committing"
    fi

    # Check for any type in TypeScript
    if echo "$file_path" | grep -qE "\.ts$" && grep -qE ": any\b" "$file_path" 2>/dev/null; then
      issues="$issues\n- Replace 'any' types with specific types"
    fi

    # Check file size
    local lines=$(wc -l < "$file_path" 2>/dev/null || echo "0")
    if [ "$lines" -gt 500 ]; then
      issues="$issues\n- File exceeds 500 lines ($lines). Consider splitting."
    fi

    if [ -n "$issues" ]; then
      cat << EOF
{"decision":"allow","reason":"Edit completed. Review suggestions:$issues","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Quality check found items to address:$issues"}}
EOF
      exit 0
    fi
  fi

  # Success with no issues
  echo '{"decision":"allow"}'
  exit 0
}

# =============================================================================
# PRE-COMMAND - Risk assessment for bash commands
# =============================================================================
pre_command_guidance() {
  local command="$1"

  # Block dangerous commands
  if echo "$command" | grep -qE "(rm -rf|drop database|truncate|--force.*push|reset --hard)"; then
    echo "BLOCKED: Destructive command detected. Use safer alternatives." >&2
    exit 2
  fi

  # Warn about risky commands
  if echo "$command" | grep -qE "(npm publish|git push|deploy)"; then
    cat << EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This command has external effects. Confirm before proceeding."}}
EOF
    exit 0
  fi

  # Guide test commands
  if echo "$command" | grep -qE "(npm test|vitest|jest)"; then
    cat << EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"Running tests. If failures occur, fix them before proceeding. Check coverage thresholds."}}
EOF
    exit 0
  fi

  exit 0
}

# =============================================================================
# ROUTE - Suggest optimal agent for task
# =============================================================================
route_task() {
  local task="$1"
  local agent="general"
  local confidence=70

  # Detect task type and suggest agent
  if echo "$task" | grep -qiE "(security|auth|cve|vuln|encrypt)"; then
    agent="security-architect"
    confidence=95
  elif echo "$task" | grep -qiE "(test|spec|mock|coverage|tdd)"; then
    agent="test-architect"
    confidence=90
  elif echo "$task" | grep -qiE "(perf|optim|fast|memory|cache)"; then
    agent="performance-engineer"
    confidence=90
  elif echo "$task" | grep -qiE "(architect|design|ddd|domain|refactor)"; then
    agent="core-architect"
    confidence=85
  elif echo "$task" | grep -qiE "(swarm|agent|coordinate|orchestrat)"; then
    agent="swarm-specialist"
    confidence=90
  elif echo "$task" | grep -qiE "(memory|agentdb|hnsw|vector)"; then
    agent="memory-specialist"
    confidence=90
  elif echo "$task" | grep -qiE "(fix|bug|error|debug)"; then
    agent="coder"
    confidence=85
  elif echo "$task" | grep -qiE "(review|quality|lint)"; then
    agent="reviewer"
    confidence=85
  fi

  cat << EOF
**Recommended Agent**: $agent
**Confidence**: $confidence%
**Task Analysis**: $(echo "$task" | head -c 100)

Use Task tool with subagent_type="$agent" for optimal results.
EOF

  exit 0
}

# =============================================================================
# STOP CHECK - Verify work is complete before stopping
# =============================================================================
stop_check() {
  local issues=""

  # Check for uncommitted changes
  local uncommitted=$(git status --porcelain 2>/dev/null | wc -l)
  if [ "$uncommitted" -gt 0 ]; then
    issues="$issues\n- $uncommitted uncommitted files"
  fi

  # Check for failing tests (if test results exist)
  if [ -f "$METRICS_DIR/test-results.json" ]; then
    local failures=$(grep -o '"failures":[0-9]*' "$METRICS_DIR/test-results.json" 2>/dev/null | cut -d: -f2)
    if [ -n "$failures" ] && [ "$failures" -gt 0 ]; then
      issues="$issues\n- $failures failing tests"
    fi
  fi

  if [ -n "$issues" ]; then
    echo "Work may be incomplete:$issues" >&2
    exit 2
  fi

  exit 0
}

# =============================================================================
# Main dispatcher
# =============================================================================
case "${1:-help}" in
  "session-context"|"session")
    session_context
    ;;
  "user-prompt"|"prompt")
    user_prompt_context "${2:-}"
    ;;
  "pre-edit")
    pre_edit_guidance "${2:-}" "${3:-Edit}"
    ;;
  "post-edit")
    post_edit_feedback "${2:-}" "${3:-true}"
    ;;
  "pre-command")
    pre_command_guidance "${2:-}"
    ;;
  "route")
    route_task "${2:-}"
    ;;
  "stop-check")
    stop_check
    ;;
  "help"|"-h"|"--help")
    cat << 'EOF'
Claude Flow V3 - Intelligent Guidance Hooks

Usage: guidance-hooks.sh <command> [args]

Commands:
  session-context         Output project context for SessionStart
  user-prompt <prompt>    Analyze prompt and inject relevant guidance
  pre-edit <path>         Validate and guide before file edit
  post-edit <path>        Provide feedback after file edit
  pre-command <cmd>       Risk assessment for bash commands
  route <task>            Suggest optimal agent for task
  stop-check              Verify work complete before stopping

Exit Codes:
  0 - Success (stdout added as context)
  2 - Block (stderr shown to Claude)
EOF
    ;;
  *)
    echo "Unknown command: $1" >&2
    exit 1
    ;;
esac

#!/bin/bash
# Tests for scripts/init-second-brain.sh

set -u

PASS=0; FAIL=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INIT_SCRIPT="$FRAMEWORK_DIR/scripts/init-second-brain.sh"

assert_true() {
  if eval "$1"; then
    ((PASS++))
    echo "  ✓ $2"
  else
    ((FAIL++))
    echo "  ✗ $2"
  fi
}
assert_file_exists() { assert_true "[ -f '$1' ]" "File exists: $1"; }
assert_dir_exists() { assert_true "[ -d '$1' ]" "Dir exists: $1"; }
assert_contains() { assert_true "grep -q '$2' '$1'" "File $1 contains '$2'"; }

# ── Setup ────────────────────────────────────────────────────────────

TEST_DIR=$(mktemp -d)
PROJECT_DIR="$TEST_DIR/test-project"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR" || exit 1
git init --quiet
git -c user.name=Test -c user.email=t@t.com commit --allow-empty -m "init" --quiet

# The brain dir name is derived from the directory basename
PROJECT_NAME="test-project"
BRAIN_DIR="$PROJECT_DIR/.brain_${PROJECT_NAME}"

echo ""
echo "── Init Script Tests ──────────────────────────────────────"
echo "   Project: $PROJECT_DIR"
echo ""

# ── Run Fresh Install (non-interactive: pipe yes to all prompts) ─────
yes | bash "$INIT_SCRIPT" "$PROJECT_DIR" 2>/dev/null

# ── Test 1: Fresh install creates brain directory ────────────────────
assert_dir_exists "$BRAIN_DIR"

# ── Test 2: Fresh install creates CLAUDE.md ──────────────────────────
assert_file_exists "$PROJECT_DIR/CLAUDE.md"

# ── Test 3: Fresh install creates .mcp.json ──────────────────────────
assert_file_exists "$PROJECT_DIR/.mcp.json"

# ── Test 4: Fresh install creates .claude/settings.json ──────────────
assert_file_exists "$PROJECT_DIR/.claude/settings.json"

# ── Test 5: brain-index.json is generated ────────────────────────────
assert_file_exists "$BRAIN_DIR/brain-index.json"

# ── Test 6: Hook scripts are executable ──────────────────────────────
if [ -d "$BRAIN_DIR/hooks" ]; then
  HOOKS_EXECUTABLE=true
  for script in "$BRAIN_DIR/hooks/"*.sh; do
    if [ -f "$script" ] && [ ! -x "$script" ]; then
      HOOKS_EXECUTABLE=false
      break
    fi
  done
  assert_true "$HOOKS_EXECUTABLE" "Hook .sh scripts are executable"
else
  ((FAIL++))
  echo "  ✗ Hook scripts are executable (hooks/ dir missing)"
fi

# ── Test 7: Re-install is idempotent ────────────────────────────────
# Create a user note to verify it is NOT destroyed on re-install
mkdir -p "$BRAIN_DIR/knowledge/memory"
echo "# My Knowledge" > "$BRAIN_DIR/knowledge/memory/user-note.md"

# Re-run the init script (answering "no" to overwrites to preserve content)
yes n | bash "$INIT_SCRIPT" "$PROJECT_DIR" 2>/dev/null

assert_file_exists "$BRAIN_DIR/knowledge/memory/user-note.md"
CONTENT=$(cat "$BRAIN_DIR/knowledge/memory/user-note.md")
assert_true "[ '$CONTENT' = '# My Knowledge' ]" "Re-install preserves user content"

# ── Test 8: CLAUDE.md contains Second Brain section ──────────────────
assert_contains "$PROJECT_DIR/CLAUDE.md" "Second Brain"
assert_contains "$PROJECT_DIR/CLAUDE.md" "Session Start Protocol"

# ── Test 9: MCP servers configured correctly ─────────────────────────
assert_contains "$PROJECT_DIR/.mcp.json" "mcpServers"
assert_contains "$PROJECT_DIR/.mcp.json" "smart-connections"

# ── Test 10: Hooks reference correct brain folder name ───────────────
assert_contains "$PROJECT_DIR/.claude/settings.json" ".brain_${PROJECT_NAME}"

# ── Cleanup ──────────────────────────────────────────────────────────
rm -rf "$TEST_DIR"

# ── Results ──────────────────────────────────────────────────────────
echo ""
echo "── Results: $PASS passed, $FAIL failed ──"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

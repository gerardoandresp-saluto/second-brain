#!/bin/bash
# brain-index-updater.sh — PostToolUse hook: incremental brain-index refresh
# Triggered on: PostToolUse (Write|Edit)
# Receives JSON on stdin: { tool_name, tool_input, tool_result }

INPUT=$(cat)

# ── Error logging ─────────────────────────────────────────────────
log_error() {
  local state_dir=""
  if [ -n "$STATE_DIR" ]; then
    state_dir="$STATE_DIR"
  else
    # Fallback: try to find brain dir for logging before we've parsed the path
    for d in "$CLAUDE_PROJECT_DIR"/.brain_*; do
      [ -d "$d" ] && state_dir="$d/hooks/.state" && break
    done
  fi
  [ -n "$state_dir" ] && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] brain-index-updater: $1" >> "$state_dir/hook-errors.log" 2>/dev/null
}

# Extract tool_name and file_path from JSON
TOOL_NAME=$(echo "$INPUT" | node -e "
  process.stdin.resume();
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).tool_name || ''); }
    catch { console.log(''); }
  });
" 2>/dev/null)

FILE_PATH=$(echo "$INPUT" | node -e "
  process.stdin.resume();
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const obj = JSON.parse(d);
      const inp = obj.tool_input || {};
      console.log(inp.path || inp.file_path || '');
    } catch { console.log(''); }
  });
" 2>/dev/null)

# Only act on markdown files inside .brain
if [[ "$FILE_PATH" != *"/.brain"* ]] || [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

# Extract brain dir — handle both .brain/ and .brain_<name>/ patterns
BRAIN_DIR=$(echo "$FILE_PATH" | sed -E 's|(/.brain[^/]*)/.*|\1|')
HOOKS_DIR="$BRAIN_DIR/hooks"
STATE_DIR="$HOOKS_DIR/.state"

# Ensure .state directory exists
mkdir -p "$STATE_DIR" 2>/dev/null

# Track this note for session delta detection
echo "$FILE_PATH" >> "$STATE_DIR/known-notes.txt"

# ── Debounce: skip rebuild if last one was <5 seconds ago ─────────
LAST_REBUILD_FILE="$STATE_DIR/last-rebuild-ts"
NOW=$(date +%s)
DEBOUNCE_SECONDS=5

if [ -f "$LAST_REBUILD_FILE" ]; then
  LAST_REBUILD=$(cat "$LAST_REBUILD_FILE" 2>/dev/null)
  if [ -n "$LAST_REBUILD" ]; then
    ELAPSED=$(( NOW - LAST_REBUILD ))
    if [ "$ELAPSED" -lt "$DEBOUNCE_SECONDS" ]; then
      # Skip rebuild but still auto-link new notes
      if [[ "$TOOL_NAME" == "Write" ]]; then
        node "$HOOKS_DIR/auto-link-note.mjs" "$BRAIN_DIR" "$FILE_PATH" &
      fi
      exit 0
    fi
  fi
fi

# Record rebuild timestamp
echo "$NOW" > "$LAST_REBUILD_FILE"

# Rebuild index in the background — do not block Claude
(node "$HOOKS_DIR/rebuild-brain-index.mjs" "$BRAIN_DIR" 2>&1 || log_error "rebuild-brain-index.mjs failed: $(cat)") &

# Auto-link new notes into MOCs (only for Write = new file creation)
if [[ "$TOOL_NAME" == "Write" ]]; then
  (node "$HOOKS_DIR/auto-link-note.mjs" "$BRAIN_DIR" "$FILE_PATH" 2>&1 || log_error "auto-link-note.mjs failed for $FILE_PATH") &
fi

exit 0

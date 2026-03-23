#!/bin/bash
# brain-router.sh — Advisory hook for .brain/ file routing
# Triggered on: PreToolUse (Write|Edit)
# Receives JSON on stdin: { tool_name, tool_input }

INPUT=$(cat)

# ── Error logging ─────────────────────────────────────────────────
BRAIN_DIR_FOR_LOG=""
for d in "$CLAUDE_PROJECT_DIR"/.brain_*; do
  [ -d "$d" ] && BRAIN_DIR_FOR_LOG="$d" && break
done
[ -z "$BRAIN_DIR_FOR_LOG" ] && [ -d "$CLAUDE_PROJECT_DIR/.brain" ] && BRAIN_DIR_FOR_LOG="$CLAUDE_PROJECT_DIR/.brain"
LOG_FILE="${BRAIN_DIR_FOR_LOG:+$BRAIN_DIR_FOR_LOG/hooks/.state/hook-errors.log}"

log_error() {
  [ -n "$LOG_FILE" ] && echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] brain-router: $1" >> "$LOG_FILE" 2>/dev/null
}

# ── Parse input ───────────────────────────────────────────────────
TOOL_NAME=$(echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_name||'')}catch{console.log('')}})" 2>/dev/null)
if [ -z "$TOOL_NAME" ]; then
  log_error "Failed to parse tool_name from stdin"
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(d).tool_input||{};console.log(p.path||p.file_path||'')}catch{console.log('')}})" 2>/dev/null)

# Only act on files inside .brain/ or .brain_*/
if [[ "$FILE_PATH" != *"/.brain"* ]]; then
  exit 0
fi

# Only warn for the Write tool (new file creation)
if [[ "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

# Check for YAML frontmatter with a type field
CONTENT=$(echo "$INPUT" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input?.content||'')}catch{console.log('')}})" 2>/dev/null)

if ! echo "$CONTENT" | grep -qE "^---" || ! echo "$CONTENT" | grep -qE "^type:"; then
  echo "[brain-router] Advisory: '$FILE_PATH' is missing YAML frontmatter with a 'type:' field." >&2
  echo "[brain-router] Consider using a template from .brain/_assets/templates/ to ensure proper routing." >&2
fi

exit 0

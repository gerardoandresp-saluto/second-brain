#!/bin/bash
# Second Brain Framework — Index Auto-Updater
# PostToolUse hook: rebuilds brain-index.json when .brain_* files are modified
BRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INPUT=$(cat)

# Extract file path from tool input JSON
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path" *: *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//')

# Only rebuild if a brain markdown file was modified
case "$FILE_PATH" in
  */.brain_*/*.md) ;;
  *) exit 0 ;;
esac

# Skip index file and obsidian config
case "$FILE_PATH" in
  */brain-index.json|*/.obsidian/*|*/hooks/*) exit 0 ;;
esac

# Rebuild in background (don't block hook timeout)
"$BRAIN_DIR/hooks/rebuild-brain-index.sh" "$BRAIN_DIR" &
exit 0

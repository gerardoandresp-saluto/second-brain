#!/bin/bash
# rebuild-brain-index.sh — Full brain-index.json rebuild
# Triggered manually or by brain-index-updater.sh
# Usage: rebuild-brain-index.sh [brain-dir] [--verbose]

BRAIN_DIR="${CLAUDE_PROJECT_DIR}/.brain"
VERBOSE=""

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE="--verbose" ;;
    *) if [ -d "$arg" ]; then BRAIN_DIR="$arg"; fi ;;
  esac
done

if [[ ! -d "$BRAIN_DIR" ]]; then
  echo "[rebuild-brain-index] .brain/ directory not found at: $BRAIN_DIR" >&2
  exit 1
fi

node "$(dirname "$0")/rebuild-brain-index.mjs" "$BRAIN_DIR" $VERBOSE

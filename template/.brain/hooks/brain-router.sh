#!/bin/bash
# Second Brain Framework — Memory Router Hook
# Runs on UserPromptSubmit to match user input against brain-index.json
BRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cat | BRAIN_DIR="$BRAIN_DIR" node "$BRAIN_DIR/hooks/brain-router.mjs" || true

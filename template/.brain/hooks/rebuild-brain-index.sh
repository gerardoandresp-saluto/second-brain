#!/bin/bash
# Second Brain Framework — Index Rebuild
# Usage: ./rebuild-brain-index.sh [/path/to/.brain_project]
BRAIN_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
node "$(dirname "$0")/rebuild-brain-index.mjs" "$BRAIN_DIR" "$@"

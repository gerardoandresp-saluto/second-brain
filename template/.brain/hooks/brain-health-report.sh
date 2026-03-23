#!/bin/bash
# brain-health-report.sh — Run full vault health check
# Usage: brain-health-report.sh <brain-dir>

BRAIN_DIR="${1:-$CLAUDE_PROJECT_DIR/.brain}"

if [ ! -d "$BRAIN_DIR" ]; then
  echo "Brain directory not found: $BRAIN_DIR"
  exit 1
fi

HOOKS_DIR="$(dirname "$0")"

echo ""
echo "═══════════════════════════════════════════"
echo "  Brain Health Report"
echo "═══════════════════════════════════════════"
echo ""

# Run validator
echo "── Validation ──"
node "$HOOKS_DIR/brain-validator.mjs" "$BRAIN_DIR"
echo ""

# Run graph analysis
echo "── Graph Analysis ──"
node "$HOOKS_DIR/brain-graph.mjs" "$BRAIN_DIR" --summary
echo ""

# Run search test (check if index is queryable)
echo "── Index Status ──"
INDEX="$BRAIN_DIR/brain-index.json"
if [ -f "$INDEX" ]; then
  NOTES=$(node -e "const idx=JSON.parse(require('fs').readFileSync('$INDEX','utf8'));console.log(idx.note_count || idx.entries?.length || 0)")
  VERSION=$(node -e "const idx=JSON.parse(require('fs').readFileSync('$INDEX','utf8'));console.log(idx.version)")
  echo "  Index version: $VERSION"
  echo "  Notes indexed: $NOTES"
  echo "  Last updated: $(node -e "const idx=JSON.parse(require('fs').readFileSync('$INDEX','utf8'));console.log(idx.updated)")"
else
  echo "  ⚠ brain-index.json not found"
fi

echo ""
echo "═══════════════════════════════════════════"

#!/bin/bash
# Second Brain Framework — Session Evaluation Prompt
# Runs on Stop event to remind the agent to evaluate the brain's performance
BRAIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRAIN_FOLDER_NAME="$(basename "$BRAIN_DIR")"

# Count notes in brain
NOTE_COUNT=$(find "$BRAIN_DIR" -name "*.md" -not -path "*/_assets/templates/*" -not -path "*/.obsidian/*" -not -path "*/hooks/*" 2>/dev/null | wc -l | tr -d ' ')

# Count orphan notes (no wiki-links out and no backlinks in)
ORPHANS=$(find "$BRAIN_DIR/knowledge" "$BRAIN_DIR/sessions" -name "*.md" 2>/dev/null | while read f; do
  links=$(grep -c '\[\[' "$f" 2>/dev/null || echo "0")
  links=$(echo "$links" | tr -d ' ')
  name=$(basename "$f" .md)
  backlinks=$(grep -rl "\[\[$name\]\]" "$BRAIN_DIR" 2>/dev/null | wc -l | tr -d ' ')
  backlinks=$(echo "$backlinks" | tr -d ' ')
  if [ "${links:-0}" -eq 0 ] && [ "${backlinks:-0}" -eq 0 ]; then
    echo "$f"
  fi
done | wc -l | tr -d ' ')

# Count notes without keywords in frontmatter
MISSING_KEYWORDS=$(find "$BRAIN_DIR/knowledge" "$BRAIN_DIR/sessions" -name "*.md" 2>/dev/null | while read f; do
  if ! grep -q "^keywords:" "$f" 2>/dev/null; then
    echo "$f"
  fi
done | wc -l | tr -d ' ')

# Check if top-of-mind was modified today
TOM="$BRAIN_DIR/00-home/top-of-mind.md"
TOM_STALE="no"
if [ -f "$TOM" ]; then
  TOM_MOD=$(stat -f %Sm -t %Y-%m-%d "$TOM" 2>/dev/null || stat -c %y "$TOM" 2>/dev/null | cut -d' ' -f1)
  TODAY=$(date +%Y-%m-%d)
  if [ "$TOM_MOD" != "$TODAY" ]; then
    TOM_STALE="yes"
  fi
fi

# Check if goal was read (we can't know for sure, but we can remind)
GOAL_EXISTS="no"
if [ -f "$BRAIN_DIR/goal/mission.md" ]; then
  MISSION_EMPTY=$(grep -c "^-$\|_Define\|_One sentence" "$BRAIN_DIR/goal/mission.md" 2>/dev/null || echo 0)
  if [ "$MISSION_EMPTY" -gt 2 ]; then
    GOAL_EXISTS="unfilled"
  else
    GOAL_EXISTS="yes"
  fi
fi

cat << EVALEOF

SESSION END — BRAIN HEALTH CHECK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total notes:           $NOTE_COUNT
Orphan notes:          $ORPHANS (target: 0)
Missing keywords:      $MISSING_KEYWORDS (target: 0)
Top-of-mind stale:     $TOM_STALE
Goal defined:          $GOAL_EXISTS

PERSIST CHECKLIST:
- [ ] Update ${BRAIN_FOLDER_NAME}/00-home/top-of-mind.md with current state
- [ ] Create knowledge claims for any new insights learned
- [ ] Add keywords to any notes missing them
- [ ] Link orphan notes to related claims
- [ ] Run brain evaluation if session was significant:
      Create a note from the brain-eval template in ${BRAIN_FOLDER_NAME}/knowledge/graph/agent-daily/

EVALEOF

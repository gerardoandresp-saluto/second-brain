#!/bin/bash
# session-eval-prompt.sh — Stop hook: gather session evidence and emit actionable directives
# Triggered on: Stop
# No stdin — uses $CLAUDE_PROJECT_DIR env var

# ── Locate brain directory ──────────────────────────────────────────
BRAIN_DIR=""
for d in "$CLAUDE_PROJECT_DIR"/.brain_*; do
  if [ -d "$d" ]; then
    BRAIN_DIR="$d"
    break
  fi
done
if [ -z "$BRAIN_DIR" ] && [ -d "$CLAUDE_PROJECT_DIR/.brain" ]; then
  BRAIN_DIR="$CLAUDE_PROJECT_DIR/.brain"
fi
if [ -z "$BRAIN_DIR" ]; then
  exit 0
fi

BRAIN_NAME="$(basename "$BRAIN_DIR")"
STATE_DIR="$BRAIN_DIR/hooks/.state"
TODAY=$(date +%Y-%m-%d)
MAX_FILES=20

# ── Error logging ─────────────────────────────────────────────────
LOG_FILE="$STATE_DIR/hook-errors.log"
log_error() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] session-eval-prompt: $1" >> "$LOG_FILE" 2>/dev/null
}

# ── Determine session start time ────────────────────────────────────
SESSION_START_TS=""
if [ -f "$STATE_DIR/session-start-ts" ]; then
  SESSION_START_TS=$(cat "$STATE_DIR/session-start-ts")
fi

# Fallback: 2 hours ago
if [ -z "$SESSION_START_TS" ]; then
  SESSION_START_TS=$(( $(date +%s) - 7200 ))
fi

# Create a reference file with the session start timestamp for find -newer
REF_FILE=$(mktemp)
touch -t "$(date -r "$SESSION_START_TS" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$SESSION_START_TS" +%Y%m%d%H%M.%S 2>/dev/null)" "$REF_FILE" 2>/dev/null
if [ $? -ne 0 ]; then
  # Fallback: use session-start-ts file itself as reference
  if [ -f "$STATE_DIR/session-start-ts" ]; then
    REF_FILE="$STATE_DIR/session-start-ts"
  fi
fi

cleanup() {
  [ -f "$REF_FILE" ] && [ "$REF_FILE" != "$STATE_DIR/session-start-ts" ] && rm -f "$REF_FILE"
}
trap cleanup EXIT

# ── Gather session evidence ─────────────────────────────────────────

# 1. Brain notes created/modified this session
NEW_BRAIN_NOTES=""
MODIFIED_BRAIN_NOTES=""

if [ -f "$REF_FILE" ]; then
  ALL_SESSION_BRAIN=$(find "$BRAIN_DIR" -name "*.md" -newer "$REF_FILE" \
    -not -path "*/_assets/*" -not -path "*/.obsidian/*" -not -path "*/hooks/*" -type f 2>/dev/null | sort)
fi

# Determine which are new vs modified by checking against known-notes snapshot
if [ -f "$STATE_DIR/known-notes.txt" ] && [ -n "$ALL_SESSION_BRAIN" ]; then
  while IFS= read -r note; do
    if grep -Fxq "$note" "$STATE_DIR/known-notes.txt" 2>/dev/null; then
      MODIFIED_BRAIN_NOTES="${MODIFIED_BRAIN_NOTES}${note}\n"
    else
      NEW_BRAIN_NOTES="${NEW_BRAIN_NOTES}${note}\n"
    fi
  done <<< "$ALL_SESSION_BRAIN"
else
  NEW_BRAIN_NOTES="$ALL_SESSION_BRAIN"
fi

# 2. Project files modified (git-based)
GIT_CHANGES=""
GIT_LOG=""
GIT_COMMIT_COUNT=0
HAS_GIT=false

if [ -d "$CLAUDE_PROJECT_DIR/.git" ]; then
  HAS_GIT=true

  # Files changed since session start (staged + unstaged + untracked)
  GIT_CHANGES=$(cd "$CLAUDE_PROJECT_DIR" && git diff --name-only HEAD 2>/dev/null | grep -v "^\.brain" | head -$MAX_FILES)
  UNTRACKED=$(cd "$CLAUDE_PROJECT_DIR" && git ls-files --others --exclude-standard 2>/dev/null | grep -v "^\.brain" | head -$MAX_FILES)
  if [ -n "$UNTRACKED" ]; then
    if [ -n "$GIT_CHANGES" ]; then
      GIT_CHANGES="${GIT_CHANGES}\n${UNTRACKED}"
    else
      GIT_CHANGES="$UNTRACKED"
    fi
  fi

  # Git log since session start
  START_ISO=$(date -r "$SESSION_START_TS" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -d "@$SESSION_START_TS" +%Y-%m-%dT%H:%M:%S 2>/dev/null)
  if [ -n "$START_ISO" ]; then
    GIT_LOG=$(cd "$CLAUDE_PROJECT_DIR" && git log --oneline --since="$START_ISO" 2>/dev/null | head -10)
    if [ -n "$GIT_LOG" ]; then
      GIT_COMMIT_COUNT=$(echo "$GIT_LOG" | wc -l | tr -d ' ')
    else
      GIT_COMMIT_COUNT=0
    fi
  fi
fi

# 3. Check if session log exists for today
EXISTING_SESSION_LOG=""
if [ -d "$BRAIN_DIR/sessions" ]; then
  EXISTING_SESSION_LOG=$(ls "$BRAIN_DIR/sessions/$TODAY"*.md 2>/dev/null | head -1)
fi

# 4. Check if top-of-mind was modified this session
TOM_MODIFIED=false
TOM_FILE="$BRAIN_DIR/00-home/top-of-mind.md"
if [ -f "$TOM_FILE" ] && [ -f "$REF_FILE" ]; then
  if [ "$TOM_FILE" -nt "$REF_FILE" ]; then
    TOM_MODIFIED=true
  fi
fi

# 5. Check for orphan notes (new notes not linked from any MOC)
ORPHAN_NOTES=""
if [ -n "$NEW_BRAIN_NOTES" ]; then
  while IFS= read -r note; do
    [ -z "$note" ] && continue
    SLUG=$(basename "$note" .md)
    # Check if linked from any MOC (index.md, projects.md, research.md)
    LINKED=false
    for moc in "$BRAIN_DIR/00-home/index.md" "$BRAIN_DIR/atlas/projects.md" "$BRAIN_DIR/atlas/research.md"; do
      if [ -f "$moc" ] && grep -q "\[\[$SLUG\]\]\|\[\[$SLUG|" "$moc" 2>/dev/null; then
        LINKED=true
        break
      fi
    done
    if [ "$LINKED" = "false" ]; then
      REL_PATH=$(echo "$note" | sed "s|$BRAIN_DIR/||")
      ORPHAN_NOTES="${ORPHAN_NOTES}  - ${REL_PATH}\n"
    fi
  done < <(echo -e "$NEW_BRAIN_NOTES")
fi

# ── Emit actionable directives ──────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "[second-brain] SESSION PERSIST — Act on each item below."
echo "════════════════════════════════════════════════════════════"

# Session activity summary
echo ""
echo "## Session Activity (auto-detected)"

if [ -n "$GIT_CHANGES" ]; then
  PROJECT_FILE_COUNT=$(echo -e "$GIT_CHANGES" | grep -c . 2>/dev/null || echo 0)
  echo "- Project files changed: $PROJECT_FILE_COUNT"
  echo -e "$GIT_CHANGES" | head -10 | sed 's/^/    /'
  if [ "$PROJECT_FILE_COUNT" -gt 10 ]; then
    echo "    ... and $(( PROJECT_FILE_COUNT - 10 )) more"
  fi
fi

if [ "${GIT_COMMIT_COUNT:-0}" -gt 0 ] 2>/dev/null; then
  echo "- Git commits this session: $GIT_COMMIT_COUNT"
fi

if [ -n "$NEW_BRAIN_NOTES" ]; then
  echo "- Brain notes created:"
  echo -e "$NEW_BRAIN_NOTES" | while IFS= read -r note; do
    [ -z "$note" ] && continue
    echo "    $(echo "$note" | sed "s|$BRAIN_DIR/||")"
  done
fi

if [ -n "$MODIFIED_BRAIN_NOTES" ]; then
  echo "- Brain notes modified:"
  echo -e "$MODIFIED_BRAIN_NOTES" | while IFS= read -r note; do
    [ -z "$note" ] && continue
    echo "    $(echo "$note" | sed "s|$BRAIN_DIR/||")"
  done
fi

# Directive 1: Session log
echo ""
if [ -n "$EXISTING_SESSION_LOG" ]; then
  echo "## 1. SESSION LOG — Already exists"
  echo "Found: $(echo "$EXISTING_SESSION_LOG" | sed "s|$BRAIN_DIR/||")"
  echo "Review and update if needed."
else
  echo "## 1. CREATE SESSION LOG"
  echo "Path: $BRAIN_NAME/sessions/$TODAY-<slug>.md"
  echo "Template: $BRAIN_NAME/_assets/templates/session-log.md"
  echo "Pre-filled data:"
  echo "  date: $TODAY"
  if [ -n "$GIT_CHANGES" ]; then
    echo "  files_touched:"
    echo -e "$GIT_CHANGES" | head -10 | sed 's/^/    - /'
  fi
  if [ -n "$NEW_BRAIN_NOTES" ]; then
    echo "  notes_created:"
    echo -e "$NEW_BRAIN_NOTES" | while IFS= read -r note; do
      [ -z "$note" ] && continue
      echo "    - $(echo "$note" | sed "s|$BRAIN_DIR/||")"
    done
  fi
  if [ -n "$GIT_LOG" ]; then
    echo "  git_summary:"
    echo "$GIT_LOG" | sed 's/^/    /'
  fi
  echo "Fill in: session goal, decisions made, what worked/didn't."
fi

# Directive 2: Top of mind
echo ""
if [ "$TOM_MODIFIED" = "true" ]; then
  echo "## 2. TOP-OF-MIND — Already updated this session"
else
  echo "## 2. UPDATE TOP-OF-MIND"
  echo "Review $BRAIN_NAME/00-home/top-of-mind.md"
  echo "Remove resolved items, add new open threads from this session."
fi

# Directive 3: Knowledge sweep
echo ""
echo "## 3. KNOWLEDGE SWEEP (most critical)"
echo "Review your conversation for knowledge worth persisting."
echo "The brain has NO access to your conversation — if you don't write it now, it's LOST."
echo ""
echo "Look for:"
echo "  - Decisions made with tradeoffs → use decision-record.md template"
echo "  - Non-obvious findings about the codebase → use knowledge-claim.md template"
echo "  - User preferences or constraints learned → knowledge-claim.md in knowledge/memory/"
echo "  - Gotchas, bug patterns, workarounds → knowledge-claim.md"
echo ""
echo "Write each to $BRAIN_NAME/knowledge/graph/ or $BRAIN_NAME/knowledge/memory/"
echo "Title each note as a claim: 'X does Y because Z', not 'notes about X'."

# Directive 4: Orphan notes (only if detected)
if [ -n "$ORPHAN_NOTES" ]; then
  echo ""
  echo "## 4. LINK ORPHAN NOTES"
  echo "These notes are not linked from any MOC:"
  echo -e "$ORPHAN_NOTES"
  echo "Add [[wiki-links]] to the relevant MOC (atlas/research.md, atlas/projects.md, or 00-home/index.md)."
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo ""

# ── Rebuild index one final time ────────────────────────────────────
if command -v node &>/dev/null; then
  node "$BRAIN_DIR/hooks/rebuild-brain-index.mjs" "$BRAIN_DIR" 2>&1 || log_error "Final index rebuild failed"
fi

# ── Clean up session state ──────────────────────────────────────────
rm -f "$STATE_DIR/session-active" 2>/dev/null

exit 0

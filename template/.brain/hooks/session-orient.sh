#!/bin/bash
# session-orient.sh — UserPromptSubmit hook: session start detection + keyword routing
# Triggered on: UserPromptSubmit
# Receives JSON on stdin: { user_prompt }

INPUT=$(cat)

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

HOOKS_DIR="$BRAIN_DIR/hooks"
STATE_DIR="$HOOKS_DIR/.state"
BRAIN_NAME="$(basename "$BRAIN_DIR")"
mkdir -p "$STATE_DIR" 2>/dev/null

# ── Session start detection ─────────────────────────────────────────
SESSION_ACTIVE="$STATE_DIR/session-active"
SESSION_START_TS="$STATE_DIR/session-start-ts"
IS_NEW_SESSION=false

if [ ! -f "$SESSION_ACTIVE" ]; then
  IS_NEW_SESSION=true
else
  # Check if session-active is older than 30 minutes
  if command -v stat &>/dev/null; then
    if [[ "$(uname)" == "Darwin" ]]; then
      FILE_AGE=$(( $(date +%s) - $(stat -f %m "$SESSION_ACTIVE") ))
    else
      FILE_AGE=$(( $(date +%s) - $(stat -c %Y "$SESSION_ACTIVE") ))
    fi
    if [ "$FILE_AGE" -gt 1800 ]; then
      IS_NEW_SESSION=true
    fi
  fi
fi

if [ "$IS_NEW_SESSION" = "true" ]; then
  # Write session timestamps
  date +%s > "$SESSION_START_TS"
  touch "$SESSION_ACTIVE"

  # Snapshot current brain notes for session delta detection
  find "$BRAIN_DIR" -name "*.md" -not -path "*/_assets/*" -not -path "*/.obsidian/*" -not -path "*/hooks/*" -type f | sort > "$STATE_DIR/known-notes.txt"

  # ── Print orientation summary ───────────────────────────────────
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "[second-brain] SESSION START — Orientation"
  echo "════════════════════════════════════════════════════"

  # Mission (first 3 non-frontmatter, non-empty lines)
  MISSION_FILE="$BRAIN_DIR/goal/mission.md"
  if [ -f "$MISSION_FILE" ]; then
    echo ""
    echo "## Mission"
    sed -n '/^---$/,/^---$/d; /^$/d; /^#/d; p' "$MISSION_FILE" | head -3
  fi

  # Top of mind (body content)
  TOM_FILE="$BRAIN_DIR/00-home/top-of-mind.md"
  if [ -f "$TOM_FILE" ]; then
    echo ""
    echo "## Top of Mind"
    sed -n '/^---$/,/^---$/!p' "$TOM_FILE" | sed '/^$/N;/^\n$/d' | head -20
  fi

  # Last session (most recent file in sessions/)
  SESSIONS_DIR="$BRAIN_DIR/sessions"
  if [ -d "$SESSIONS_DIR" ]; then
    LAST_SESSION=$(ls -t "$SESSIONS_DIR"/*.md 2>/dev/null | head -1)
    if [ -n "$LAST_SESSION" ]; then
      echo ""
      echo "## Last Session"
      echo "File: $(basename "$LAST_SESSION")"
      # Show Context and Decisions sections
      sed -n '/^---$/,/^---$/!p' "$LAST_SESSION" | head -15
    fi
  fi

  # Brain stats
  INDEX_FILE="$BRAIN_DIR/brain-index.json"
  if [ -f "$INDEX_FILE" ]; then
    NOTE_COUNT=$(node -e "try{const i=JSON.parse(require('fs').readFileSync('$INDEX_FILE','utf8'));console.log(i.note_count||i.entries?.length||0)}catch{console.log('?')}" 2>/dev/null)
    UPDATED=$(node -e "try{const i=JSON.parse(require('fs').readFileSync('$INDEX_FILE','utf8'));console.log(i.updated||'unknown')}catch{console.log('unknown')}" 2>/dev/null)
    echo ""
    echo "## Brain Status"
    echo "Notes indexed: $NOTE_COUNT | Last updated: $UPDATED"
  fi

  echo ""
  echo "════════════════════════════════════════════════════"
  echo ""
fi

# ── Update session-active timestamp ─────────────────────────────────
touch "$SESSION_ACTIVE"

# ── Keyword routing (every prompt) ──────────────────────────────────
USER_PROMPT=$(echo "$INPUT" | node -e "
  process.stdin.resume();
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { console.log(JSON.parse(d).user_prompt || ''); }
    catch { console.log(''); }
  });
" 2>/dev/null)

if [ -n "$USER_PROMPT" ] && [ -f "$BRAIN_DIR/brain-index.json" ]; then
  # Extract meaningful words (4+ chars, skip common words)
  KEYWORDS=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alpha:]' '\n' | awk 'length >= 4' | head -8)

  if [ -n "$KEYWORDS" ]; then
    # Convert newline-separated words to space-separated args
    KEYWORD_ARGS=$(echo "$KEYWORDS" | tr '\n' ' ')

    RESULTS=$(node "$HOOKS_DIR/brain-search.mjs" "$BRAIN_DIR" $KEYWORD_ARGS 2>/dev/null)

    # Check if we got results with scores above threshold
    MATCH_COUNT=$(echo "$RESULTS" | node -e "
      process.stdin.resume();
      let d = '';
      process.stdin.on('data', c => d += c);
      process.stdin.on('end', () => {
        try {
          const r = JSON.parse(d);
          const hits = r.filter(e => e.score >= 3);
          console.log(hits.length);
        } catch { console.log('0'); }
      });
    " 2>/dev/null)

    if [ "$MATCH_COUNT" -gt 0 ]; then
      echo "[second-brain] Relevant notes for this prompt:"
      echo "$RESULTS" | node -e "
        process.stdin.resume();
        let d = '';
        process.stdin.on('data', c => d += c);
        process.stdin.on('end', () => {
          try {
            const r = JSON.parse(d).filter(e => e.score >= 3).slice(0, 5);
            for (const e of r) {
              const score = e.score.toFixed(1);
              const summary = e.s ? ' — ' + e.s : '';
              console.log('  ' + e.p + summary + ' (score: ' + score + ')');
            }
          } catch {}
        });
      " 2>/dev/null
      echo ""
    fi
  fi
fi

# ── Auto-populate prompt detection (moved from brain-router.sh) ─────
AUTO_PROMPT="$STATE_DIR/auto-populate-prompt.md"
if [ -f "$AUTO_PROMPT" ]; then
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "[second-brain] Auto-populate prompt detected!"
  echo "════════════════════════════════════════════════════"
  echo ""
  cat "$AUTO_PROMPT"
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "[second-brain] Please create the brain notes above."
  echo "════════════════════════════════════════════════════"
  echo ""
  mv "$AUTO_PROMPT" "$AUTO_PROMPT.done"
fi

exit 0

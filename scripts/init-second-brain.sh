#!/bin/bash
# Second Brain Framework - Initialization Script
# Usage: ./init-second-brain.sh [/path/to/your/project]
# Or:    curl -sSL <raw-url>/scripts/init-second-brain.sh | bash -s -- [/path/to/your/project]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Repository URL for cloning when run via curl
REPO_URL="https://github.com/YOUR_USERNAME/second-brain-project.git"

# Section markers for CLAUDE.md integration
SECTION_START="<!-- SECOND-BRAIN-FRAMEWORK:START -->"
SECTION_END="<!-- SECOND-BRAIN-FRAMEWORK:END -->"

# ── Source Resolution ────────────────────────────────────────────────
if [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    FRAMEWORK_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
    TEMP_CLONE=""
else
    echo "Downloading Second Brain framework..."
    TEMP_CLONE="$(mktemp -d)"
    git clone --depth 1 --quiet "$REPO_URL" "$TEMP_CLONE"
    FRAMEWORK_DIR="$TEMP_CLONE"
fi

cleanup() {
    if [ -n "$TEMP_CLONE" ] && [ -d "$TEMP_CLONE" ]; then
        rm -rf "$TEMP_CLONE"
    fi
}
trap cleanup EXIT

# ── Target Directory ─────────────────────────────────────────────────
TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd || echo "$TARGET_DIR")"
# Brain directory name is .brain_<project-name> so each vault is unique in Obsidian
# Determined after detect_project_name runs (see below)

# ── Helper Functions ─────────────────────────────────────────────────
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error()   { echo -e "${RED}✗${NC} $1"; }
print_info()    { echo -e "${BLUE}ℹ${NC} $1"; }

confirm() {
    local prompt="$1"
    local response
    read -r -p "$prompt [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

show_file_diff() {
    local existing="$1"
    local new="$2"
    local name="$3"

    if command -v diff &>/dev/null; then
        echo ""
        echo -e "${BLUE}--- Diff for ${name} ---${NC}"
        if diff --color=auto /dev/null /dev/null 2>/dev/null; then
            diff --color=auto -u "$existing" "$new" 2>/dev/null || true
        else
            diff -u "$existing" "$new" 2>/dev/null || true
        fi
        echo -e "${BLUE}--- End diff ---${NC}"
        echo ""
    fi
}

show_dir_diff() {
    local existing="$1"
    local new="$2"
    local name="$3"

    if command -v diff &>/dev/null; then
        echo ""
        echo -e "${BLUE}--- Changes in ${name}/ ---${NC}"

        local new_files
        new_files=$(diff -rq "$existing" "$new" 2>/dev/null | grep "Only in $new" | sed "s|Only in $new[^:]*: |  + |" || true)
        if [ -n "$new_files" ]; then
            echo -e "${GREEN}New files:${NC}"
            echo "$new_files"
        fi

        local removed_files
        removed_files=$(diff -rq "$existing" "$new" 2>/dev/null | grep "Only in $existing" | sed "s|Only in $existing[^:]*: |  - |" || true)
        if [ -n "$removed_files" ]; then
            echo -e "${RED}Files only in existing:${NC}"
            echo "$removed_files"
        fi

        local modified_files
        modified_files=$(diff -rq "$existing" "$new" 2>/dev/null | grep "^Files .* differ$" | sed -E 's/Files (.*) and .* differ/  ~ \1/' || true)
        if [ -n "$modified_files" ]; then
            echo -e "${YELLOW}Modified files:${NC}"
            echo "$modified_files"
        fi

        local total_changes
        total_changes=$(diff -rq "$existing" "$new" 2>/dev/null | wc -l | tr -d ' ')
        echo ""
        echo "Total: $total_changes file(s) differ"
        echo -e "${BLUE}--- End summary ---${NC}"
        echo ""
    fi
}

copy_file_with_diff() {
    local src="$1"
    local dst="$2"
    local name="$3"
    local optional="${4:-false}"

    if [ ! -f "$src" ]; then
        if [ "$optional" = "true" ]; then return 0; fi
        print_error "Source file not found: $src"
        return 1
    fi

    if [ -f "$dst" ]; then
        if diff -q "$dst" "$src" &>/dev/null; then
            print_info "$name is already up to date"
            return 0
        fi
        print_warning "$name already exists with differences"
        show_file_diff "$dst" "$src" "$name"
        if confirm "  Overwrite $name?"; then
            cp "$src" "$dst"
            print_success "$name updated"
        else
            print_info "Skipped $name"
        fi
    else
        cp "$src" "$dst"
        print_success "$name installed"
    fi
}

copy_dir_with_diff() {
    local src="$1"
    local dst="$2"
    local name="$3"

    if [ ! -d "$src" ]; then
        print_error "Source directory not found: $src"
        return 1
    fi

    if [ -d "$dst" ]; then
        if diff -rq "$dst" "$src" &>/dev/null; then
            print_info "$name/ is already up to date"
            return 0
        fi

        # Check for user-created content (files beyond the template)
        local user_content
        user_content=$(find "$dst/knowledge" "$dst/sessions" "$dst/voice-notes" "$dst/inbox" \
            -type f ! -name '.gitkeep' ! -name '.DS_Store' 2>/dev/null | head -5)

        if [ -n "$user_content" ]; then
            print_warning "$name/ contains user-created notes:"
            echo "$user_content" | while read -r f; do echo "    $f"; done
            echo ""
            print_warning "Overwriting will DESTROY your knowledge notes!"
            if ! confirm "  Are you sure you want to overwrite $name/?"; then
                print_info "Skipped $name/ (user content preserved)"
                return 0
            fi
        else
            print_warning "$name/ already exists with differences"
            show_dir_diff "$dst" "$src" "$name"
            if ! confirm "  Overwrite $name/?"; then
                print_info "Skipped $name/"
                return 0
            fi
        fi

        rm -rf "$dst"
        cp -r "$src" "$dst"
        print_success "$name/ updated"
    else
        cp -r "$src" "$dst"
        print_success "$name/ installed"
    fi
}

# ── Detect Project Name ──────────────────────────────────────────────
detect_project_name() {
    local dir="$1"
    if [ -d "$dir/.git" ] || git -C "$dir" rev-parse --git-dir &>/dev/null 2>&1; then
        local remote_url
        remote_url=$(git -C "$dir" remote get-url origin 2>/dev/null || echo "")
        if [ -n "$remote_url" ]; then
            local repo_name
            repo_name=$(echo "$remote_url" | sed -E 's#.*/([^/]+)(\.git)?$#\1#' | sed 's/\.git$//')
            if [ -n "$repo_name" ]; then
                echo "$repo_name"
                return
            fi
        fi
    fi
    basename "$dir"
}

# ── Validate ─────────────────────────────────────────────────────────
if [ ! -d "$TARGET_DIR" ]; then
    print_error "Target directory does not exist: $TARGET_DIR"
    exit 1
fi

PROJECT_NAME="$(detect_project_name "$TARGET_DIR")"
BRAIN_DIR="$TARGET_DIR/.brain_${PROJECT_NAME}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Second Brain Framework - Initialization"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
print_info "Framework source: $FRAMEWORK_DIR"
print_info "Target directory: $TARGET_DIR"
print_info "Project name:     $PROJECT_NAME"
print_info "Vault location:   $BRAIN_DIR"
echo ""

# ══════════════════════════════════════════════════════════════════════
# 1. COPY VAULT STRUCTURE
# ══════════════════════════════════════════════════════════════════════
echo "── Vault Structure ──────────────────────────────────────"
copy_dir_with_diff "$FRAMEWORK_DIR/template/.brain" "$BRAIN_DIR" ".brain"

# ══════════════════════════════════════════════════════════════════════
# 2. CLAUDE.md INTEGRATION
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── CLAUDE.md ───────────────────────────────────────────"

# Create a temp copy of CLAUDE-second-brain.md with the actual brain folder name
BRAIN_MD_TEMPLATE="$FRAMEWORK_DIR/template/CLAUDE-second-brain.md"
BRAIN_MD=$(mktemp)
BRAIN_FOLDER_NAME="$(basename "$BRAIN_DIR")"
sed "s|\.brain/|${BRAIN_FOLDER_NAME}/|g" "$BRAIN_MD_TEMPLATE" > "$BRAIN_MD"

if [ ! -f "$TARGET_DIR/CLAUDE.md" ]; then
    # Scenario A: No CLAUDE.md — create with brain content
    print_info "Creating CLAUDE.md with Second Brain section..."

    cat > "$TARGET_DIR/CLAUDE.md" << 'HEADER'
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HEADER
    cat "$BRAIN_MD" >> "$TARGET_DIR/CLAUDE.md"
    print_success "CLAUDE.md created"

elif grep -q "$SECTION_START" "$TARGET_DIR/CLAUDE.md"; then
    # Scenario C: Section exists — check if it needs updating
    # Extract existing section to a temp file
    EXISTING_SECTION=$(mktemp)
    sed -n "/$SECTION_START/,/$SECTION_END/p" "$TARGET_DIR/CLAUDE.md" > "$EXISTING_SECTION"

    if diff -q "$EXISTING_SECTION" "$BRAIN_MD" &>/dev/null; then
        print_info "Second Brain section in CLAUDE.md is already up to date"
    else
        print_warning "Second Brain section in CLAUDE.md has differences"
        show_file_diff "$EXISTING_SECTION" "$BRAIN_MD" "CLAUDE.md (Second Brain section)"

        if confirm "  Replace the Second Brain section?"; then
            # Replace the section between markers
            BEFORE=$(mktemp)
            AFTER=$(mktemp)
            sed -n "1,/$SECTION_START/{ /$SECTION_START/!p }" "$TARGET_DIR/CLAUDE.md" > "$BEFORE"
            sed -n "/$SECTION_END/,\${ /$SECTION_END/!p }" "$TARGET_DIR/CLAUDE.md" > "$AFTER"

            cat "$BEFORE" "$BRAIN_MD" "$AFTER" > "$TARGET_DIR/CLAUDE.md"
            print_success "Second Brain section updated in CLAUDE.md"
            rm -f "$BEFORE" "$AFTER"
        else
            print_info "Kept existing Second Brain section"
        fi
    fi
    rm -f "$EXISTING_SECTION"

else
    # Scenario B: CLAUDE.md exists but no brain section — append
    print_info "Appending Second Brain section to existing CLAUDE.md..."
    echo "" >> "$TARGET_DIR/CLAUDE.md"
    echo "" >> "$TARGET_DIR/CLAUDE.md"
    cat "$BRAIN_MD" >> "$TARGET_DIR/CLAUDE.md"
    print_success "Second Brain section appended to CLAUDE.md"
fi

# ══════════════════════════════════════════════════════════════════════
# 3. MCP CONFIG MERGE
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── MCP Configuration ────────────────────────────────────"

MCP_SERVERS="$FRAMEWORK_DIR/template/mcp-servers.json"
MCP_TARGET="$TARGET_DIR/.mcp.json"

if [ ! -f "$MCP_TARGET" ]; then
    # No existing .mcp.json — create it
    print_info "Creating .mcp.json with Second Brain MCP servers..."

    # Resolve absolute vault path for MCP servers
    ABS_BRAIN_DIR="$TARGET_DIR/.brain"

    cat > "$MCP_TARGET" << MCPEOF
{
  "mcpServers": $(cat "$MCP_SERVERS")
}
MCPEOF
    print_success ".mcp.json created"

elif command -v jq &>/dev/null; then
    # Merge new servers into existing .mcp.json
    NEW_SERVERS=$(jq -r 'keys[]' "$MCP_SERVERS")
    SERVERS_TO_ADD=""

    for server in $NEW_SERVERS; do
        if jq -e ".mcpServers.\"$server\"" "$MCP_TARGET" &>/dev/null; then
            print_info "MCP server '$server' already configured"
        else
            SERVERS_TO_ADD="$SERVERS_TO_ADD $server"
        fi
    done

    if [ -z "$SERVERS_TO_ADD" ]; then
        print_info ".mcp.json already has all Second Brain servers"
    else
        print_info "Adding MCP servers:$SERVERS_TO_ADD"
        if confirm "  Add these servers to .mcp.json?"; then
            MERGED=$(jq --slurpfile new "$MCP_SERVERS" '.mcpServers += $new[0]' "$MCP_TARGET")
            echo "$MERGED" > "$MCP_TARGET"
            print_success ".mcp.json updated with Second Brain servers"
        else
            print_info "Skipped MCP config update"
        fi
    fi
else
    print_warning "jq not found — cannot automatically merge .mcp.json"
    print_info "Please manually add the following servers to your .mcp.json:"
    echo ""
    cat "$MCP_SERVERS"
    echo ""
fi

# ══════════════════════════════════════════════════════════════════════
# 4. .GITIGNORE UPDATE
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── .gitignore ─────────────────────────────────────────"

# Create temp gitignore entries with actual brain folder name
GITIGNORE_TEMPLATE="$FRAMEWORK_DIR/template/gitignore-entries.txt"
GITIGNORE_FILE=$(mktemp)
sed "s|\.brain|${BRAIN_FOLDER_NAME}|g" "$GITIGNORE_TEMPLATE" > "$GITIGNORE_FILE"

if [ ! -f "$TARGET_DIR/.gitignore" ]; then
    print_warning ".gitignore does not exist"
    if confirm "  Create .gitignore with Second Brain entries?"; then
        echo "# Second Brain Framework" > "$TARGET_DIR/.gitignore"
        cat "$GITIGNORE_FILE" >> "$TARGET_DIR/.gitignore"
        echo "" >> "$TARGET_DIR/.gitignore"
        echo "# OS" >> "$TARGET_DIR/.gitignore"
        echo ".DS_Store" >> "$TARGET_DIR/.gitignore"
        print_success ".gitignore created"
    else
        print_info "Skipped .gitignore"
    fi
else
    MISSING_ENTRIES=()
    while IFS= read -r entry; do
        [ -z "$entry" ] && continue
        [[ "$entry" == \#* ]] && continue
        if ! grep -Fxq "$entry" "$TARGET_DIR/.gitignore" 2>/dev/null; then
            MISSING_ENTRIES+=("$entry")
        fi
    done < "$GITIGNORE_FILE"

    if [ ${#MISSING_ENTRIES[@]} -eq 0 ]; then
        print_info ".gitignore already contains all Second Brain entries"
    else
        print_warning ".gitignore is missing ${#MISSING_ENTRIES[@]} entries"
        echo ""
        echo -e "${BLUE}--- Entries to append ---${NC}"
        for entry in "${MISSING_ENTRIES[@]}"; do
            echo -e "${GREEN}  + $entry${NC}"
        done
        echo -e "${BLUE}--- End entries ---${NC}"
        echo ""

        if confirm "  Append missing entries to .gitignore?"; then
            if [ -s "$TARGET_DIR/.gitignore" ] && [ "$(tail -c1 "$TARGET_DIR/.gitignore" | wc -l)" -eq 0 ]; then
                echo "" >> "$TARGET_DIR/.gitignore"
            fi
            echo "" >> "$TARGET_DIR/.gitignore"
            echo "# Second Brain Framework" >> "$TARGET_DIR/.gitignore"
            for entry in "${MISSING_ENTRIES[@]}"; do
                echo "$entry" >> "$TARGET_DIR/.gitignore"
            done
            print_success ".gitignore updated (${#MISSING_ENTRIES[@]} entries appended)"
        else
            print_info "Kept existing .gitignore"
        fi
    fi
fi

# ══════════════════════════════════════════════════════════════════════
# 5. HOOKS CONFIGURATION
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── Hooks Configuration ──────────────────────────────────"

# Make hook scripts executable
if [ -d "$BRAIN_DIR/hooks" ]; then
    chmod +x "$BRAIN_DIR/hooks/"*.sh 2>/dev/null || true
    print_success "Hook scripts made executable"
fi

# Merge hooks into .claude/settings.json
SETTINGS_DIR="$TARGET_DIR/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

mkdir -p "$SETTINGS_DIR"

if command -v jq &>/dev/null; then
    BRAIN_FOLDER_NAME="$(basename "$BRAIN_DIR")"

    if [ ! -f "$SETTINGS_FILE" ]; then
        # Create new settings.json with brain hooks
        cat > "$SETTINGS_FILE" << SETTINGSEOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/brain-router.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/brain-index-updater.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/session-eval-prompt.sh",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
SETTINGSEOF
        print_success ".claude/settings.json created with brain hooks"

    elif ! grep -q "brain-router" "$SETTINGS_FILE" 2>/dev/null; then
        # Merge brain hooks into existing settings
        print_info "Merging brain hooks into existing .claude/settings.json..."

        ROUTER_HOOK="{\"matcher\":\"\",\"hooks\":[{\"type\":\"command\",\"command\":\"\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/brain-router.sh\",\"timeout\":5000}]}"
        UPDATER_HOOK="{\"matcher\":\"Write|Edit\",\"hooks\":[{\"type\":\"command\",\"command\":\"\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/brain-index-updater.sh\",\"timeout\":5000}]}"
        EVAL_HOOK="{\"matcher\":\"\",\"hooks\":[{\"type\":\"command\",\"command\":\"\$CLAUDE_PROJECT_DIR/${BRAIN_FOLDER_NAME}/hooks/session-eval-prompt.sh\",\"timeout\":10000}]}"

        MERGED=$(jq \
            --argjson router "$ROUTER_HOOK" \
            --argjson updater "$UPDATER_HOOK" \
            --argjson eval "$EVAL_HOOK" \
            '.hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) + [$router]) | .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [$updater]) | .hooks.Stop = ((.hooks.Stop // []) + [$eval])' \
            "$SETTINGS_FILE")

        echo "$MERGED" > "$SETTINGS_FILE"
        print_success "Brain hooks merged into .claude/settings.json"
    else
        print_info "Brain hooks already configured in .claude/settings.json"
    fi
else
    print_warning "jq not found — cannot automatically configure hooks"
    print_info "Please add the following hooks to .claude/settings.json manually:"
    echo ""
    echo '  "hooks": {'
    echo '    "UserPromptSubmit": [{"matcher":"","hooks":[{"type":"command","command":"$CLAUDE_PROJECT_DIR/.brain/hooks/brain-router.sh","timeout":5000}]}],'
    echo '    "PostToolUse": [{"matcher":"Write|Edit","hooks":[{"type":"command","command":"$CLAUDE_PROJECT_DIR/.brain/hooks/brain-index-updater.sh","timeout":5000}]}]'
    echo '  }'
    echo ""
fi

# ══════════════════════════════════════════════════════════════════════
# 6. BUILD BRAIN INDEX
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── Brain Index ────────────────────────────────────────"

if command -v node &>/dev/null; then
    "$BRAIN_DIR/hooks/rebuild-brain-index.sh" "$BRAIN_DIR" --verbose 2>/dev/null
    print_success "brain-index.json built"
else
    print_warning "Node.js not found — brain-index.json not populated"
    print_info "Install Node.js and run: .brain/hooks/rebuild-brain-index.sh"
fi

# ══════════════════════════════════════════════════════════════════════
# 7. REGISTER OBSIDIAN VAULT
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "── Obsidian Vault Registration ──────────────────────────"

OBSIDIAN_CONFIG="$HOME/Library/Application Support/obsidian/obsidian.json"
VAULT_DISPLAY_NAME=".brain_${PROJECT_NAME}"
VAULT_PATH="$BRAIN_DIR"

if [ -f "$OBSIDIAN_CONFIG" ] && command -v jq &>/dev/null; then
    # Check if vault path is already registered
    EXISTING=$(jq -r --arg path "$VAULT_PATH" '.vaults | to_entries[] | select(.value.path == $path) | .key' "$OBSIDIAN_CONFIG" 2>/dev/null)

    if [ -n "$EXISTING" ]; then
        print_info "Vault already registered in Obsidian as $VAULT_DISPLAY_NAME"
    else
        # Generate a random vault ID (16 hex chars, matching Obsidian's format)
        VAULT_ID=$(LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 16)
        TIMESTAMP=$(date +%s)000

        # Add vault entry
        UPDATED=$(jq --arg id "$VAULT_ID" --arg path "$VAULT_PATH" --arg ts "$TIMESTAMP" \
            '.vaults[$id] = {"path": $path, "ts": ($ts | tonumber)}' "$OBSIDIAN_CONFIG")
        echo "$UPDATED" > "$OBSIDIAN_CONFIG"
        print_success "Vault registered in Obsidian as $VAULT_DISPLAY_NAME"
        print_info "Restart Obsidian or open vault switcher to see it"
    fi
else
    if [ ! -f "$OBSIDIAN_CONFIG" ]; then
        print_info "Obsidian not detected — open the vault manually:"
        print_info "  Open Obsidian → Open folder as vault → $VAULT_PATH"
    else
        print_warning "jq not found — register vault manually in Obsidian"
        print_info "  Open Obsidian → Open folder as vault → $VAULT_PATH"
    fi
fi

# ══════════════════════════════════════════════════════════════════════
# DONE
# ══════════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_success "Second Brain initialization complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Vault name in Obsidian: $VAULT_DISPLAY_NAME"
echo ""
echo "  Next Steps:"
echo ""
echo "  1. Open the vault in Obsidian:"
echo "     obsidian open vault=\"$VAULT_DISPLAY_NAME\" path=\"00-home/index.md\""
echo ""
echo "  2. Start your first session:"
echo "     cd $TARGET_DIR && claude"
echo "     The session rhythm is: Orient → Work → Persist"
echo ""
echo "  3. Memory routing is active:"
echo "     Brain hooks auto-suggest relevant memories on each prompt"
echo "     The index auto-rebuilds when you write to brain files"
echo ""
echo "  4. MCP servers have been configured in .mcp.json"
echo "     Restart Claude Code to pick up the new configuration"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

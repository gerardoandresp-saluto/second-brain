# Second Brain Framework

A portable, installable knowledge persistence system for AI agents. Drop a structured Obsidian vault into any project with a single command.

## What This Is

A template second brain that gives AI agents a memory architecture from day one. Each project gets its own fresh, empty brain with all the rules, conventions, templates, and structure baked in — but zero project knowledge.

The portability is the **system itself**, not the data.

## Installation

### From GitHub (one command)

```bash
curl -sSL https://raw.githubusercontent.com/gerardoandresp-saluto/second-brain/main/scripts/init-second-brain.sh | bash -s -- /path/to/your/project
```

### From local clone

```bash
git clone https://github.com/gerardoandresp-saluto/second-brain.git
cd second-brain-project
./scripts/init-second-brain.sh /path/to/your/project
```

### What gets installed

| Destination | What |
|-------------|------|
| `.brain/` | Obsidian vault with full folder structure, templates, and seed notes |
| `CLAUDE.md` | Second Brain section appended (or created) with agent instructions |
| `.mcp.json` | MCP server config for vault connectivity (merged if exists) |
| `.gitignore` | Vault-specific entries appended |

### Re-running is safe

The script detects existing installations, shows diffs, and asks before overwriting. It will warn you if `.brain/` contains user-created notes.

## How It Works

### 3-Layer Memory Architecture

```
Layer 3: Ingestion Pipeline    — video/audio/meetings -> structured knowledge
Layer 2: Knowledge Graph       — .brain/ Obsidian vault + MCP bridge
Layer 1: Session Memory        — CLAUDE.md + auto-memory directory
```

### Session Rhythm

Every agent session follows: **Orient** (read context) → **Work** (operate) → **Persist** (write back what was learned).

### Vault Structure

```
.brain/
├── 00-home/          # Maps of content, daily notes, top-of-mind
├── atlas/            # Projects, research, vault architecture
├── inbox/            # Everything lands here first
├── knowledge/        # Curated brain (atomic claims, research, memory)
├── sessions/         # Session transcripts
├── voice-notes/      # Transcribed captures
└── _assets/          # Templates and attachments
```

### Key Convention: Prose-as-Title

Notes are named as claims, not categories:
- `memory graphs beat giant memory files.md`
- NOT `memory-systems.md`

## Compatibility

Works alongside the [Claude Agentic Framework](https://github.com/dralgorhythm/claude-agentic-framework). The installer merges into existing `CLAUDE.md`, `.mcp.json`, and `.gitignore` without conflicts.

## After Installation

1. Open `.brain/` as an Obsidian vault
2. Restart Claude Code to pick up MCP config
3. Start your first session — read `.brain/00-home/index.md`

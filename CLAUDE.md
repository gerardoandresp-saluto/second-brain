# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This is the **Second Brain Framework** — an installable template that drops a knowledge persistence system (Obsidian vault) into any project via `scripts/init-second-brain.sh`.

## Repo Structure

```
scripts/init-second-brain.sh     — The installer (copies template into target projects)
template/.brain/                 — The vault template (what gets installed)
template/CLAUDE-second-brain.md  — CLAUDE.md section (appended to target's CLAUDE.md)
template/mcp-servers.json        — MCP server definitions (merged into target's .mcp.json)
template/gitignore-entries.txt   — Gitignore entries (appended to target's .gitignore)
```

## Development Guidelines

- The vault template lives in `template/.brain/` — edit vault content there, not at the repo root
- All vault paths in `CLAUDE-second-brain.md` must be prefixed with `.brain/` since that's where they install
- The init script must be idempotent — safe to re-run without destroying user content
- The CLAUDE.md section uses HTML comment markers (`<!-- SECOND-BRAIN-FRAMEWORK:START/END -->`) for safe merging
- Keep notes in prose-as-title format (claims, not categories)
- One atomic claim per knowledge note, with YAML frontmatter

## Testing Changes

```bash
# Test fresh install
mkdir /tmp/test-project && cd /tmp/test-project && git init
/path/to/scripts/init-second-brain.sh .

# Test install alongside agentic framework
# (use a project that already has .claude/, CLAUDE.md, .mcp.json)

# Test re-install (should show "already up to date")
/path/to/scripts/init-second-brain.sh .
```
